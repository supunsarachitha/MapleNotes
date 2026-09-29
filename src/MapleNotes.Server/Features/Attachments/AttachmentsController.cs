using MapleNotes.Server.Features.Auth;
using MapleNotes.Server.Infrastructure.Configuration;
using MapleNotes.Server.Infrastructure.Storage;
using MapleNotes.Server.Infrastructure.Web;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.WebUtilities;
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

    /// <summary>Uploads a file.</summary>
    /// <remarks>
    /// Send <c>multipart/form-data</c> with one file part. The file is streamed straight to storage (encrypted when
    /// the account has encryption at rest switched on) and is never buffered whole in memory. Attach it to a note by
    /// passing its ID in the note's <c>attachmentIds</c>; uploads not attached to a note within 24 hours are removed.
    /// </remarks>
    /// <param name="cancellationToken">Cancels the upload.</param>
    /// <returns>The stored attachment.</returns>
    /// <response code="201">The file was stored.</response>
    /// <response code="400">The request contains no file.</response>
    /// <response code="413">The file exceeds <c>MAPLE_MAX_UPLOAD_MB</c>.</response>
    /// <response code="415">The request is not <c>multipart/form-data</c>.</response>
    [HttpPost]
    [DisableFormValueModelBinding]
    [Consumes("multipart/form-data")]
    [ProducesResponseType<AttachmentResponse>(StatusCodes.Status201Created)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status413PayloadTooLarge)]
    [ProducesResponseType(StatusCodes.Status415UnsupportedMediaType)]
    public async Task<ActionResult<AttachmentResponse>> Upload(CancellationToken cancellationToken)
    {
        if (HttpContext.Features.Get<IHttpMaxRequestBodySizeFeature>() is { IsReadOnly: false } bodyLimit)
        {
            bodyLimit.MaxRequestBodySize = options.MaxUploadBytes + MultipartOverheadBytes;
        }

        if (!MediaTypeHeaderValue.TryParse(Request.ContentType, out var mediaType)
            || HeaderUtilities.RemoveQuotes(mediaType.Boundary).Value is not { Length: > 0 and <= 70 } boundary)
        {
            return Problem(statusCode: StatusCodes.Status400BadRequest, title: "The upload is not valid multipart/form-data.");
        }

        var reader = new MultipartReader(boundary, Request.Body) { HeadersLengthLimit = 16 * 1024 };
        while (await reader.ReadNextSectionAsync(cancellationToken) is { } section)
        {
            if (!ContentDispositionHeaderValue.TryParse(section.ContentDisposition, out var disposition)
                || !disposition.IsFileDisposition())
            {
                continue;
            }

            var fileName = disposition.FileNameStar.HasValue
                ? disposition.FileNameStar.Value
                : HeaderUtilities.RemoveQuotes(disposition.FileName).Value;
            try
            {
                var attachment = await attachments.UploadAsync(
                    User.GetUserId(), fileName, section.ContentType, section.Body, cancellationToken);
                return CreatedAtAction(nameof(Download), new { id = attachment.Id }, AttachmentResponse.From(attachment));
            }
            catch (UploadTooLargeException tooLarge)
            {
                return Problem(statusCode: StatusCodes.Status413PayloadTooLarge, title: tooLarge.Message);
            }
        }

        return Problem(statusCode: StatusCodes.Status400BadRequest, title: "The upload contains no file.");
    }

    /// <summary>Downloads a file, decrypting it on the fly. Supports HTTP Range requests.</summary>
    /// <remarks>
    /// Images, audio, video and plain text are served inline; anything else is always served as a download with a
    /// generic content type, so uploaded HTML or SVG can never run in the app's origin.
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
        var inline = !download && UploadPolicy.CanDisplayInline(attachment.ContentType);
        var disposition = new ContentDispositionHeaderValue(inline ? "inline" : "attachment");
        disposition.SetHttpFileName(attachment.FileName);

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
