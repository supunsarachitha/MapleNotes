using MapleNotes.Server.Domain;
using MapleNotes.Server.Features.Auth;
using Microsoft.AspNetCore.Mvc;

namespace MapleNotes.Server.Features.Preferences;

/// <summary>The signed-in user's writing and feature preferences.</summary>
/// <param name="preferences">Preference operations.</param>
[ApiController]
[Route("api/v1/account/preferences")]
[Produces("application/json")]
public sealed class PreferencesController(PreferencesService preferences) : ControllerBase
{
    /// <summary>Returns the preferences (also part of the signed-in user).</summary>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>The preferences.</returns>
    /// <response code="200">The preferences.</response>
    [HttpGet]
    [ProducesResponseType<UserPreferences>(StatusCodes.Status200OK)]
    public Task<UserPreferences> Get(CancellationToken cancellationToken) =>
        preferences.GetAsync(User.GetUserId(), cancellationToken);

    /// <summary>Replaces the preferences. Send every field; omitted fields take their default value.</summary>
    /// <param name="request">The new preferences.</param>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>The saved preferences.</returns>
    /// <response code="200">The preferences were saved.</response>
    /// <response code="400">The date format, theme or accent colour is not one of the offered ones.</response>
    [HttpPut]
    [ProducesResponseType<UserPreferences>(StatusCodes.Status200OK)]
    [ProducesResponseType<ValidationProblemDetails>(StatusCodes.Status400BadRequest)]
    public Task<UserPreferences> Set(UserPreferences request, CancellationToken cancellationToken) =>
        preferences.SetAsync(User.GetUserId(), request, cancellationToken);
}
