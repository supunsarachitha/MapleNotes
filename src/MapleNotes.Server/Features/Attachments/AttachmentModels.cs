using MapleNotes.Server.Domain;

namespace MapleNotes.Server.Features.Attachments;

/// <summary>An attachment as returned by the API.</summary>
/// <param name="Id">Attachment ID; pass it in a note's <c>attachmentIds</c> to attach the file.</param>
/// <param name="FileName">Original file name; null for an end-to-end encrypted file.</param>
/// <param name="ContentType">Media type; null for an end-to-end encrypted file.</param>
/// <param name="SizeBytes">Size of the file as stored (for an end-to-end file: the ciphertext).</param>
/// <param name="IsImage">Whether the app can display the file as an image.</param>
/// <param name="Url">Where to download the file (requires the session cookie). End-to-end files download as ciphertext.</param>
/// <param name="CreatedAtUtc">When the file was uploaded.</param>
/// <param name="EncryptedMetadata">For an end-to-end file: its name, type and size, for the browser to decrypt.</param>
public sealed record AttachmentResponse(
    Guid Id, string? FileName, string? ContentType, long SizeBytes, bool IsImage, string Url, DateTime CreatedAtUtc,
    byte[]? EncryptedMetadata = null)
{
    /// <summary>Maps an attachment entity to its API representation.</summary>
    /// <param name="attachment">The attachment.</param>
    /// <returns>The API representation.</returns>
    public static AttachmentResponse From(Attachment attachment)
    {
        var url = $"/api/v1/attachments/{attachment.Id}";
        return attachment.Scheme == ContentScheme.EndToEnd
            ? new(attachment.Id, null, null, attachment.SizeBytes, false, url, attachment.CreatedAtUtc, attachment.EncryptedMetadata)
            : new(attachment.Id, attachment.FileName, attachment.ContentType, attachment.SizeBytes,
                UploadPolicy.IsImage(attachment.ContentType), url, attachment.CreatedAtUtc);
    }
}

/// <summary>What an end-to-end encrypted upload carries besides the file.</summary>
/// <param name="Id">The ID the browser chose and bound into the ciphertext (UUID version 7).</param>
/// <param name="Metadata">The file's name, type and size, encrypted by the browser.</param>
public sealed record EncryptedUpload(Guid? Id, byte[]? Metadata);

/// <summary>An open attachment: its metadata and a readable (decrypted) stream of its content.</summary>
/// <param name="Attachment">Metadata.</param>
/// <param name="Content">The file content; seekable. The caller disposes it.</param>
public sealed record AttachmentContent(Attachment Attachment, Stream Content);
