using MapleNotes.Server.Domain;
using MapleNotes.Server.Features.Admin;
using MapleNotes.Server.Infrastructure.Web;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace MapleNotes.Server.Features.Branding;

/// <summary>
/// The app's icon, which administrators can replace with their own. Anyone may fetch it, since the sign-in page shows
/// it. Only PNG, JPEG and WebP images are accepted (never SVG or anything that could run), and it is served with the
/// same sandboxing policy as attachments.
/// </summary>
/// <param name="settings">Instance settings, which hold the icon.</param>
[ApiController]
[Produces("application/json")]
public sealed class BrandingController(InstanceSettingsService settings) : ControllerBase
{
    /// <summary>Returns the custom icon.</summary>
    /// <remarks>With <c>?v=</c> set to the current version (as the status response links it), it may be cached for good.</remarks>
    /// <param name="v">The version the link was made for.</param>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>The image.</returns>
    /// <response code="200">The icon.</response>
    /// <response code="404">The app uses its own icon.</response>
    [HttpGet("api/v1/branding/icon")]
    [AllowAnonymous]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetIcon(string? v, CancellationToken cancellationToken)
    {
        if (await settings.GetIconAsync(cancellationToken) is not { } icon)
        {
            return NotFound();
        }

        Response.Headers.CacheControl = v == icon.Version ? "public, max-age=31536000, immutable" : "no-cache";
        Response.Headers.ContentSecurityPolicy = SecurityHeaders.AttachmentContentSecurityPolicy;
        return File(icon.Content, icon.ContentType);
    }

    /// <summary>Replaces the app's icon.</summary>
    /// <remarks>Send the image itself as the body: a PNG, JPEG or WebP file of at most 256 KB, ideally square.</remarks>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>No content.</returns>
    /// <response code="204">The icon was replaced.</response>
    /// <response code="400">The body is not a PNG, JPEG or WebP image.</response>
    /// <response code="403">Not an administrator.</response>
    /// <response code="413">The image is larger than 256 KB.</response>
    /// <response code="415">The body is not sent as <c>image/png</c>, <c>image/jpeg</c> or <c>image/webp</c>.</response>
    [HttpPut("api/v1/admin/branding/icon")]
    [Authorize(Roles = nameof(UserRole.Admin))]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType<ValidationProblemDetails>(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status413PayloadTooLarge)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status415UnsupportedMediaType)]
    public async Task<IActionResult> SetIcon(CancellationToken cancellationToken)
    {
        // Checked here rather than with [Consumes], whose rejection falls through to the app's catch-all route (404).
        if (Request.ContentType?.Split(';')[0].Trim().ToLowerInvariant() is not ("image/png" or "image/jpeg" or "image/webp"))
        {
            return Problem(statusCode: StatusCodes.Status415UnsupportedMediaType, title: "Send the icon as image/png, image/jpeg or image/webp.");
        }

        var buffer = new byte[InstanceSettingsService.MaxIconBytes + 1];
        var length = await Request.Body.ReadAtLeastAsync(buffer, buffer.Length, throwOnEndOfStream: false, cancellationToken);
        if (length > InstanceSettingsService.MaxIconBytes)
        {
            return Problem(statusCode: StatusCodes.Status413PayloadTooLarge, title: "The icon is larger than 256 KB.");
        }

        var content = buffer[..length];
        if (InstanceSettingsService.DetectIconType(content) is not { } type)
        {
            throw new ApiValidationException("icon", "Choose a PNG, JPEG or WebP image.");
        }

        await settings.SetIconAsync(content, type, cancellationToken);
        return NoContent();
    }

    /// <summary>Goes back to the app's own icon.</summary>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>No content.</returns>
    /// <response code="204">The custom icon is gone.</response>
    /// <response code="403">Not an administrator.</response>
    [HttpDelete("api/v1/admin/branding/icon")]
    [Authorize(Roles = nameof(UserRole.Admin))]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<IActionResult> RemoveIcon(CancellationToken cancellationToken)
    {
        await settings.RemoveIconAsync(cancellationToken);
        return NoContent();
    }
}
