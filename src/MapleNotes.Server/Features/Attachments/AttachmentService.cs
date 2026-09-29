using MapleNotes.Server.Domain;
using MapleNotes.Server.Features.Encryption;
using MapleNotes.Server.Features.EndToEnd;
using MapleNotes.Server.Infrastructure.Configuration;
using MapleNotes.Server.Infrastructure.Crypto;
using MapleNotes.Server.Infrastructure.Persistence;
using MapleNotes.Server.Infrastructure.Storage;
using Microsoft.EntityFrameworkCore;

namespace MapleNotes.Server.Features.Attachments;

/// <summary>
/// Stores, reads and deletes attachments, encrypting them with the owner's data key when the owner uses encryption at
/// rest.
/// </summary>
/// <param name="db">Database context.</param>
/// <param name="store">File store.</param>
/// <param name="keys">Per-request data keys.</param>
/// <param name="options">Instance settings (upload size limit).</param>
/// <param name="time">Clock.</param>
public sealed class AttachmentService(
    MapleDbContext db, AttachmentStore store, UserContentKeys keys, MapleOptions options, TimeProvider time)
{
    /// <summary>
    /// Streams an upload into the store (encrypting it on the way if required) and records it. The attachment is not
    /// linked to a note yet; unlinked uploads are removed by <see cref="AttachmentCleanup"/> after 24 hours.
    /// </summary>
    /// <param name="userId">The owner.</param>
    /// <param name="fileName">File name supplied by the client.</param>
    /// <param name="contentType">Content type supplied by the client.</param>
    /// <param name="content">The file content; read once, never buffered whole.</param>
    /// <param name="encrypted">For an end-to-end account: the browser's ID and encrypted metadata for the file.</param>
    /// <param name="cancellationToken">Cancels the upload; nothing is kept.</param>
    /// <returns>The stored attachment.</returns>
    /// <exception cref="UploadTooLargeException">The file is larger than <c>MAPLE_MAX_UPLOAD_MB</c>.</exception>
    /// <exception cref="Infrastructure.Web.ApiProblemException">The upload does not match the account's mode, or the
    /// chosen ID is taken.</exception>
    /// <exception cref="Infrastructure.Web.ApiValidationException">An end-to-end upload is malformed.</exception>
    public async Task<Attachment> UploadAsync(
        Guid userId, string? fileName, string? contentType, Stream content, EncryptedUpload? encrypted, CancellationToken cancellationToken)
    {
        var mode = await keys.GetModeAsync(userId, cancellationToken);
        if (encrypted is not null)
        {
            return await UploadEncryptedAsync(userId, mode, content, encrypted, cancellationToken);
        }

        var scheme = ContentSchemes.ForPlainText(mode);
        var id = Guid.CreateVersion7();
        var storageKey = AttachmentStore.CreateStorageKey(id);
        var limited = new LengthLimitedStream(content, options.MaxUploadBytes);
        var key = scheme == ContentScheme.Server ? await keys.GetKeyAsync(userId, cancellationToken) : null;

        await store.WriteAsync(storageKey, (file, ct) => key is null
            ? limited.CopyToAsync(file, ct)
            : AttachmentCipher.EncryptAsync(limited, file, key, userId, id, ct), cancellationToken: cancellationToken);

        var safeName = UploadPolicy.SanitizeFileName(fileName);
        var attachment = new Attachment
        {
            Id = id,
            UserId = userId,
            FileName = safeName,
            ContentType = UploadPolicy.ResolveContentType(contentType, safeName),
            SizeBytes = limited.BytesRead,
            StorageKey = storageKey,
            Scheme = scheme,
            CreatedAtUtc = time.GetUtcNow().UtcDateTime,
        };

        db.Attachments.Add(attachment);
        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch
        {
            store.Delete(storageKey);
            throw;
        }

        return attachment;
    }

    /// <summary>
    /// Stores a file the browser encrypted (docs/e2ee-spec.md §5), checking what the server can: the header, that
    /// every chunk is complete, the size limit (allowing for the encryption overhead) and the browser's ID.
    /// </summary>
    private async Task<Attachment> UploadEncryptedAsync(
        Guid userId, EncryptionMode mode, Stream content, EncryptedUpload encrypted, CancellationToken cancellationToken)
    {
        if (mode != EncryptionMode.EndToEnd)
        {
            throw new Infrastructure.Web.ApiProblemException(
                StatusCodes.Status409Conflict,
                "This account does not use end-to-end encryption.",
                "Upload the file as it is; the server protects it according to the account's settings.");
        }

        var now = time.GetUtcNow().UtcDateTime;
        if (EndToEndContent.ValidateClientId(encrypted.Id, now) is { } idError)
        {
            throw new Infrastructure.Web.ApiValidationException("id", idError);
        }

        if (!EndToEndContent.IsEnvelope(encrypted.Metadata, EndToEndContent.MaxMetadataEnvelopeBytes))
        {
            throw new Infrastructure.Web.ApiValidationException("metadata", "This is not encrypted file metadata.");
        }

        var id = encrypted.Id!.Value;
        if (await db.Attachments.AnyAsync(a => a.Id == id, cancellationToken))
        {
            throw new Infrastructure.Web.ApiProblemException(StatusCodes.Status409Conflict, "A file with this ID already exists.");
        }

        var storageKey = AttachmentStore.CreateStorageKey(id);
        var limited = new LengthLimitedStream(content, EndToEndContent.MaxAttachmentCiphertextBytes(options.MaxUploadBytes));
        await store.WriteAsync(storageKey, async (file, ct) =>
        {
            var header = new byte[EndToEndContent.AttachmentHeaderBytes];
            if (await limited.ReadAtLeastAsync(header, header.Length, throwOnEndOfStream: false, ct) < header.Length
                || !EndToEndContent.IsAttachmentHeader(header))
            {
                throw new Infrastructure.Web.ApiValidationException("file", "This is not an end-to-end encrypted file.");
            }

            await file.WriteAsync(header, ct);
            await limited.CopyToAsync(file, ct);
            if (!EndToEndContent.IsAttachmentSize(limited.BytesRead))
            {
                throw new Infrastructure.Web.ApiValidationException("file", "The encrypted file is incomplete.");
            }
        }, cancellationToken: cancellationToken);

        var attachment = new Attachment
        {
            Id = id,
            UserId = userId,
            FileName = string.Empty,
            ContentType = UploadPolicy.DownloadContentType,
            SizeBytes = limited.BytesRead,
            StorageKey = storageKey,
            Scheme = ContentScheme.EndToEnd,
            EncryptedMetadata = encrypted.Metadata,
            CreatedAtUtc = now,
        };

        db.Attachments.Add(attachment);
        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch
        {
            store.Delete(storageKey);
            throw;
        }

        return attachment;
    }

    /// <summary>Returns one of the user's attachments without its content.</summary>
    /// <param name="userId">The owner.</param>
    /// <param name="attachmentId">The attachment.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>The attachment, or null when it does not exist or belongs to someone else.</returns>
    public Task<Attachment?> FindAsync(Guid userId, Guid attachmentId, CancellationToken cancellationToken) =>
        db.Attachments.AsNoTracking().SingleOrDefaultAsync(a => a.Id == attachmentId && a.UserId == userId, cancellationToken);

    /// <summary>Opens one of the user's attachments for reading, decrypting it transparently.</summary>
    /// <param name="userId">The owner (requests for other users' attachments find nothing).</param>
    /// <param name="attachmentId">The attachment.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>The attachment and its content, or null when it does not exist or belongs to someone else.</returns>
    public async Task<AttachmentContent?> OpenAsync(Guid userId, Guid attachmentId, CancellationToken cancellationToken)
    {
        var attachment = await db.Attachments.AsNoTracking()
            .SingleOrDefaultAsync(a => a.Id == attachmentId && a.UserId == userId, cancellationToken);
        if (attachment is null)
        {
            return null;
        }

        return new AttachmentContent(attachment, await OpenContentAsync(attachment, cancellationToken));
    }

    /// <summary>Opens the content of an attachment the caller has already loaded (and authorized).</summary>
    /// <param name="attachment">The attachment.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>
    /// A seekable stream of the content, decrypted when the server encrypted it; an end-to-end encrypted file is
    /// returned as stored, for the browser to decrypt. The caller disposes it.
    /// </returns>
    public async Task<Stream> OpenContentAsync(Attachment attachment, CancellationToken cancellationToken)
    {
        var file = store.OpenRead(attachment.StorageKey);
        if (attachment.Scheme != ContentScheme.Server)
        {
            return file;
        }

        try
        {
            var key = await keys.GetKeyAsync(attachment.UserId, cancellationToken);
            return DecryptingAttachmentStream.Open(file, key, attachment.UserId, attachment.Id);
        }
        catch
        {
            await file.DisposeAsync();
            throw;
        }
    }

    /// <summary>Deletes one of the user's attachments and its file.</summary>
    /// <param name="userId">The owner.</param>
    /// <param name="attachmentId">The attachment.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>False when the attachment does not exist or belongs to someone else.</returns>
    public async Task<bool> DeleteAsync(Guid userId, Guid attachmentId, CancellationToken cancellationToken)
    {
        var attachment = await db.Attachments.SingleOrDefaultAsync(a => a.Id == attachmentId && a.UserId == userId, cancellationToken);
        if (attachment is null)
        {
            return false;
        }

        db.Attachments.Remove(attachment);
        await db.SaveChangesAsync(cancellationToken);
        store.Delete(attachment.StorageKey);
        return true;
    }
}
