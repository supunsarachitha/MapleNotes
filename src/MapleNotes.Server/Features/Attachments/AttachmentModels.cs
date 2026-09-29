using MapleNotes.Server.Domain;

namespace MapleNotes.Server.Features.Attachments;

/// <summary>An attachment as returned by the API.</summary>
/// <param name="Id">Attachment ID; pass it in a note's <c>attachmentIds</c> to attach the file.</param>
/// <param name="FileName">Original file name.</param>
/// <param name="ContentType">Media type.</param>
/// <param name="SizeBytes">Size of the file.</param>
/// <param name="IsImage">Whether the app can display the file as an image.</param>
/// <param name="Url">Where to download the file (requires the session cookie).</param>
/// <param name="CreatedAtUtc">When the file was uploaded.</param>
public sealed record AttachmentResponse(
    Guid Id, string FileName, string ContentType, long SizeBytes, bool IsImage, string Url, DateTime CreatedAtUtc)
{
    /// <summary>Maps an attachment entity to its API representation.</summary>
    /// <param name="attachment">The attachment.</param>
    /// <returns>The API representation.</returns>
    public static AttachmentResponse From(Attachment attachment) =>
        new(attachment.Id, attachment.FileName, attachment.ContentType, attachment.SizeBytes,
            UploadPolicy.IsImage(attachment.ContentType), $"/api/v1/attachments/{attachment.Id}", attachment.CreatedAtUtc);
}

/// <summary>An open attachment: its metadata and a readable (decrypted) stream of its content.</summary>
/// <param name="Attachment">Metadata.</param>
/// <param name="Content">The file content; seekable. The caller disposes it.</param>
public sealed record AttachmentContent(Attachment Attachment, Stream Content);
