using MapleNotes.Server.Features.Auth;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Net.Http.Headers;

namespace MapleNotes.Server.Features.Export;

/// <summary>Export notes as a ZIP archive.</summary>
/// <param name="exporter">Writes the archive.</param>
[ApiController]
[Route("api/v1/export")]
public sealed class ExportController(NoteExporter exporter) : ControllerBase
{
    /// <summary>Downloads the signed-in user's notes, decrypted, as a ZIP archive.</summary>
    /// <remarks>
    /// The archive contains one file per note in the chosen format (Markdown, plain text or JSON), arranged by the
    /// chosen layout (for example <c>2026-09/…</c> for monthly folders), decrypted attachments under
    /// <c>attachments/</c> linked from the notes by relative path, and a <c>manifest.json</c> describing the export.
    /// It is streamed while being generated, so large exports start downloading at once. This is a plain GET so the
    /// browser can save the download directly to disk.
    /// </remarks>
    /// <param name="request">Format, layout and filters.</param>
    /// <param name="cancellationToken">Cancels the export when the download is aborted.</param>
    /// <returns>The ZIP archive.</returns>
    /// <response code="200">The archive (streamed).</response>
    /// <response code="400">An option is invalid (for example an unknown time zone).</response>
    [HttpGet]
    [Produces("application/zip")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType<ValidationProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    public async Task Export([FromQuery] ExportRequest request, CancellationToken cancellationToken)
    {
        var options = NoteExporter.Validate(request);

        var disposition = new ContentDispositionHeaderValue("attachment");
        disposition.SetHttpFileName(exporter.FileName(options));
        Response.ContentType = "application/zip";
        Response.Headers.ContentDisposition = disposition.ToString();
        Response.Headers.CacheControl = "no-store";

        await exporter.StreamAsync(User.GetUserId(), options, Response.Body, cancellationToken);
    }
}
