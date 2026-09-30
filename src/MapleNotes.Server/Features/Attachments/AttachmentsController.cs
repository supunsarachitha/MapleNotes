using MapleNotes.Server.Domain;
using MapleNotes.Server.Features.Auth;
using MapleNotes.Server.Features.EndToEnd;
using MapleNotes.Server.Infrastructure.Configuration;
using MapleNotes.Server.Infrastructure.Storage;
using MapleNotes.Server.Infrastructure.Web;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Net.Http.Headers;

namespace MapleNotes.Server.Features.Attachments;

/// <summary>Upload, download and delete files attached to notes.</summary>
/// <param name="attachments">Attachment operations.</param>
/// <param name="options">Instance settings (upload size limit).</param>
[ApiController]
[Route("api/v1/attachments")]
[Produces("application/json")]
public sealed class AttachmentsController(AttachmentService attachments, MapleOptions options) : ControllerBase
{
    private const long MultipartOverheadBytes = 64 * 1024;

    private static readonly HashSet<string> EncryptedUploadFields = new(StringComparer.OrdinalIgnoreCase) { "id", "metadata" };

    /// <summary>Uploads a file.</summary>
    /// <remarks>
    /// <para>
    /// Send <c>multipart/form-data</c> with one file part. The file is streamed straight to storage (encrypted when
    /// the account uses encryption at rest) and is never buffered whole in memory. Attach it to a note by passing its
    /// ID in the note's <c>attachmentIds</c>; uploads not attached to a note within 24 hours are removed.
    /// </para>
    /// <para>
    /// An account in end-to-end mode uploads the file encrypted by the browser (docs/e2ee-spec.md §5) and sends two
    /// form fields before the file part: <c>id</c>, the UUID version 7 the browser chose and bound into the ciphertext,
    /// and <c>metadata</c>, the base64 of the encrypted name, type and size.
    /// </para>
    /// </remarks>
    /// <param name="cancellationToken">Cancels the upload.</param>
    /// <returns>The stored attachment.</returns>
    /// <response code="201">The file was stored.</response>
    /// <response code="400">The request contains no file.</response>
    /// <response code="413">The file exceeds <c>MAPLE_MAX_UPLOAD_MB</c>.</response>
    /// <response code="415">The request is not <c>multipart/form-data</c>.</response>
    /// <response code="507">The account's storage limit leaves no room for this.</response>
    [HttpPost]
    [DisableFormValueModelBinding]
    [Consumes("multipart/form-data")]
    [ProducesResponseType<AttachmentResponse>(StatusCodes.Status201Created)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status413PayloadTooLarge)]
    [ProducesResponseType(StatusCodes.Status415UnsupportedMediaType)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status507InsufficientStorage)]
    public async Task<ActionResult<AttachmentResponse>> Upload(CancellationToken cancellationToken)
    {
        if (HttpContext.Features.Get<IHttpMaxRequestBodySizeFeature>() is { IsReadOnly: false } bodyLimit)
        {
            // End-to-end files arrive encrypted: a header and one tag per 64 KiB chunk on top of the file itself.
            bodyLimit.MaxRequestBodySize = EndToEndContent.MaxAttachmentCiphertextBytes(options.MaxUploadBytes) + MultipartOverheadBytes;
        }

        try
        {
            var attachment = await MultipartUpload.ReadAsync(Request, EncryptedUploadFields, file => attachments.UploadAsync(
                User.GetUserId(),
                file.FileName,
                file.ContentType,
                file.Body,
                file.Fields.Count > 0 ? new EncryptedUpload(file.Guid("id"), file.Base64("metadata", EndToEndContent.MaxMetadataEnvelopeBytes)) : null,
                cancellationToken), cancellationToken);
            return CreatedAtAction(nameof(Download), new { id = attachment.Id }, AttachmentResponse.From(attachment));
        }
        catch (UploadTooLargeException tooLarge)
        {
            return Problem(statusCode: StatusCodes.Status413PayloadTooLarge, title: tooLarge.Message);
        }
    }

    /// <summary>Returns a file's details without its content.</summary>
    /// <remarks>The app's media service worker uses this to read an end-to-end file's encrypted name and type.</remarks>
    /// <param name="id">Attachment ID.</param>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>The attachment.</returns>
    /// <response code="200">The attachment.</response>
    /// <response code="404">No such attachment for this account.</response>
    [HttpGet("{id:guid}/info")]
    [ProducesResponseType<AttachmentResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<AttachmentResponse>> GetInfo(Guid id, CancellationToken cancellationToken) =>
        await attachments.FindAsync(User.GetUserId(), id, cancellationToken) is { } attachment
            ? AttachmentResponse.From(attachment)
            : NotFound();

    /// <summary>Downloads a file, decrypting it on the fly. Supports HTTP Range requests.</summary>
    /// <remarks>
    /// Images, audio, video and plain text are served inline; anything else is always served as a download with a
    /// generic content type, so uploaded HTML or SVG can never run in the app's origin. An end-to-end encrypted file
    /// is served as stored, as a download: the browser decrypts it (the app's service worker fetches the byte ranges
    /// it needs).
    /// </remarks>
    /// <param name="id">Attachment ID.</param>
    /// <param name="download">Force a download even for types that could display inline.</param>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>The file content.</returns>
    /// <response code="200">The whole file.</response>
    /// <response code="206">The requested byte range.</response>
    /// <response code="404">No such attachment for this account.</response>
    [HttpGet("{id:guid}")]
    [Produces("application/octet-stream")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status206PartialContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Download(Guid id, [FromQuery] bool download = false, CancellationToken cancellationToken = default)
    {
        var opened = await attachments.OpenAsync(User.GetUserId(), id, cancellationToken);
        if (opened is null)
        {
            return NotFound();
        }

        var attachment = opened.Attachment;
        var endToEnd = attachment.Scheme == ContentScheme.EndToEnd;
        var inline = !download && !endToEnd && UploadPolicy.CanDisplayInline(attachment.ContentType);
        var disposition = new ContentDispositionHeaderValue(inline ? "inline" : "attachment");
        disposition.SetHttpFileName(endToEnd ? $"{attachment.Id:N}.bin" : attachment.FileName);

        Response.Headers.ContentDisposition = disposition.ToString();
        Response.Headers.ContentSecurityPolicy = SecurityHeaders.AttachmentContentSecurityPolicy;
        Response.Headers.CacheControl = "private, max-age=31536000, immutable"; // an attachment's content never changes
        return File(opened.Content, inline ? attachment.ContentType : UploadPolicy.DownloadContentType, enableRangeProcessing: true);
    }

    /// <summary>Deletes a file (and removes it from its note).</summary>
    /// <param name="id">Attachment ID.</param>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>No content.</returns>
    /// <response code="204">The file was deleted.</response>
    /// <response code="404">No such attachment for this account.</response>
    [HttpDelete("{id:guid}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Delete(Guid id, CancellationToken cancellationToken) =>
        await attachments.DeleteAsync(User.GetUserId(), id, cancellationToken) ? NoContent() : NotFound();
}
