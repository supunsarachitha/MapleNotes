using MapleNotes.Server.Domain;
using MapleNotes.Server.Infrastructure.Configuration;
using MapleNotes.Server.Infrastructure.Crypto;
using MapleNotes.Server.Infrastructure.Persistence;
using MapleNotes.Server.Infrastructure.Storage;
using Microsoft.EntityFrameworkCore;

namespace MapleNotes.Server.Features.Attachments;

/// <summary>
/// Stores, reads and deletes attachments, encrypting them with the owner's data key when the owner has encryption at
/// rest switched on.
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
    /// <param name="cancellationToken">Cancels the upload; nothing is kept.</param>
    /// <returns>The stored attachment.</returns>
    /// <exception cref="UploadTooLargeException">The file is larger than <c>MAPLE_MAX_UPLOAD_MB</c>.</exception>
    public async Task<Attachment> UploadAsync(
        Guid userId, string? fileName, string? contentType, Stream content, CancellationToken cancellationToken)
    {
        var id = Guid.CreateVersion7();
        var storageKey = AttachmentStore.CreateStorageKey(id);
        var encrypt = await keys.IsEncryptionEnabledAsync(userId, cancellationToken);
        var limited = new LengthLimitedStream(content, options.MaxUploadBytes);
        var key = encrypt ? await keys.GetKeyAsync(userId, cancellationToken) : null;

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
            IsEncrypted = encrypt,
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
    /// <returns>A seekable stream of the decrypted content; the caller disposes it.</returns>
    public async Task<Stream> OpenContentAsync(Attachment attachment, CancellationToken cancellationToken)
    {
        var file = store.OpenRead(attachment.StorageKey);
        if (!attachment.IsEncrypted)
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
