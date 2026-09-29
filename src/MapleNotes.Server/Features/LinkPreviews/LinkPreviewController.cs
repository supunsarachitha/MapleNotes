using MapleNotes.Server.Features.Auth;
using MapleNotes.Server.Features.Preferences;
using MapleNotes.Server.Infrastructure.Configuration;
using MapleNotes.Server.Infrastructure.Web;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace MapleNotes.Server.Features.LinkPreviews;

/// <summary>Previews of links in notes, for accounts that turned them on.</summary>
/// <param name="previews">Fetches previews.</param>
/// <param name="preferences">The account's preferences.</param>
/// <param name="options">Instance settings (<c>MAPLE_LINK_PREVIEWS</c>).</param>
[ApiController]
[Route("api/v1/link-preview")]
[Produces("application/json")]
public sealed class LinkPreviewController(LinkPreviewService previews, PreferencesService preferences, MapleOptions options) : ControllerBase
{
    /// <summary>Returns the title, description and site name of a web page.</summary>
    /// <remarks>
    /// The server fetches the page, so it learns the link (also for end-to-end accounts); the account must have turned
    /// link previews on. Only public http(s) addresses on the standard ports are fetched.
    /// </remarks>
    /// <param name="url">The link.</param>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>The preview.</returns>
    /// <response code="200">The preview.</response>
    /// <response code="204">The page has no preview (not HTML, unreachable, no title).</response>
    /// <response code="400">The link may not be fetched (not http(s), a private address, another port).</response>
    /// <response code="403">This account has link previews turned off.</response>
    /// <response code="404">Link previews are turned off on this server.</response>
    /// <response code="429">Too many previews asked for in a minute.</response>
    [HttpGet]
    [EnableRateLimiting(RateLimitPolicies.LinkPreview)]
    [ProducesResponseType<LinkPreviewResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType<ValidationProblemDetails>(StatusCodes.Status400BadRequest)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Get([FromQuery] string url, CancellationToken cancellationToken)
    {
        if (!options.LinkPreviews)
        {
            return NotFound();
        }

        if (!(await preferences.GetAsync(User.GetUserId(), cancellationToken)).LinkPreviews)
        {
            return Problem(statusCode: StatusCodes.Status403Forbidden, title: "Link previews are turned off for this account.");
        }

        return await previews.GetAsync(url, cancellationToken) is { } preview ? Ok(preview) : NoContent();
    }
}
