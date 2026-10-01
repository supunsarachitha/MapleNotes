using MapleNotes.Server.Features.Attachments;
using MapleNotes.Server.Features.Auth;
using MapleNotes.Server.Infrastructure.Web;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Mvc;

namespace MapleNotes.Server.Features.EndToEnd;

/// <summary>
/// The browser's conversion of existing content after a change to or from end-to-end encryption. Progress is also
/// reported by <c>GET /api/v1/account/encryption</c>.
/// </summary>
/// <param name="conversion">Conversion operations.</param>
[ApiController]
[Route("api/v1/account/conversion")]
[Produces("application/json")]
public sealed class ConversionController(ConversionService conversion) : ControllerBase
{
    private const long MultipartOverheadBytes = 64 * 1024;

    private static readonly HashSet<string> Fields = new(StringComparer.OrdinalIgnoreCase) { "metadata" };

    /// <summary>Returns the next notes, files and labels to convert.</summary>
    /// <remarks>
    /// In end-to-end mode the batch holds plain items to encrypt (notes with their text); otherwise end-to-end items
    /// to decrypt. Files' content is downloaded from their usual URL. Labels are converted by saving their name again
    /// with <c>PUT /api/v1/labels/{id}</c>. An empty batch means the browser has nothing left to do.
    /// </remarks>
    /// <param name="limit">Batch size, 1–50; default 20.</param>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>The batch.</returns>
    /// <response code="200">The batch (never cached).</response>
    [HttpGet]
    [ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
    [ProducesResponseType<ConversionBatchResponse>(StatusCodes.Status200OK)]
    public Task<ConversionBatchResponse> GetBatch([FromQuery] int? limit, CancellationToken cancellationToken) =>
        conversion.GetBatchAsync(User.GetUserId(), limit, cancellationToken);

    /// <summary>Stores a converted note, keeping its timestamps.</summary>
    /// <param name="id">Note ID.</param>
    /// <param name="request">The converted text and the note's last-edit time from the batch.</param>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>No content.</returns>
    /// <response code="204">The note is converted.</response>
    /// <response code="400">The converted text is missing or malformed.</response>
    /// <response code="404">The note no longer exists.</response>
    /// <response code="409">Already converted, or edited since the batch was fetched.</response>
    [HttpPut("notes/{id:guid}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType<ValidationProblemDetails>(StatusCodes.Status400BadRequest)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict)]
    public async Task<IActionResult> ConvertNote(Guid id, ConvertNoteRequest request, CancellationToken cancellationToken)
    {
        await conversion.ConvertNoteAsync(User.GetUserId(), id, request, cancellationToken);
        return NoContent();
    }

    /// <summary>Stores a converted file.</summary>
    /// <remarks>
    /// Send <c>multipart/form-data</c> with one file part. Entering end-to-end mode: the file encrypted for this
    /// attachment's ID, preceded by the form field <c>metadata</c> (the encrypted name, type and size). Leaving it:
    /// the decrypted file, with its name and type on the file part.
    /// </remarks>
    /// <param name="id">Attachment ID.</param>
    /// <param name="cancellationToken">Cancels the request; nothing changes.</param>
    /// <returns>No content.</returns>
    /// <response code="204">The file is converted.</response>
    /// <response code="400">The upload is malformed.</response>
    /// <response code="404">The file no longer exists.</response>
    /// <response code="409">Already converted.</response>
    [HttpPut("attachments/{id:guid}")]
    [DisableFormValueModelBinding]
    [Consumes("multipart/form-data")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict)]
    public async Task<IActionResult> ConvertAttachment(Guid id, CancellationToken cancellationToken)
    {
        // A file converts at its own size, whatever the current upload limit.
        if (HttpContext.Features.Get<IHttpMaxRequestBodySizeFeature>() is { IsReadOnly: false } bodyLimit
            && await conversion.MaxAttachmentBytesAsync(User.GetUserId(), id, cancellationToken) is { } maxBytes)
        {
            bodyLimit.MaxRequestBodySize = maxBytes + MultipartOverheadBytes;
        }

        await MultipartUpload.ReadAsync(Request, Fields, file => conversion.ConvertAttachmentAsync(User.GetUserId(), id, file, cancellationToken), cancellationToken);
        return NoContent();
    }
}
