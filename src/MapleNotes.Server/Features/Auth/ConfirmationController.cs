using MapleNotes.Server.Features.Passkeys;
using MapleNotes.Server.Infrastructure.Web;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace MapleNotes.Server.Features.Auth;

/// <summary>Step-up confirmation: proving inside a session that its owner is present.</summary>
/// <remarks>
/// Exports, administration, passkey changes, turning off two-factor sign-in and replacing recovery codes answer 403
/// with <c>code: "confirmation_required"</c> unless this session signed in or confirmed in the last ten minutes. Confirm
/// with <c>POST</c>, then repeat the request. Each session confirms for itself.
/// </remarks>
/// <param name="confirmations">Checks and records confirmations.</param>
/// <param name="sessions">Reads the current confirmation.</param>
/// <param name="passkeys">Issues passkey challenges.</param>
[ApiController]
[Route("api/v1/auth/confirm")]
[Produces("application/json")]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class ConfirmationController(ConfirmationService confirmations, SessionService sessions, PasskeyService passkeys) : ControllerBase
{
    /// <summary>Returns until when this session counts as recently confirmed.</summary>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>The end of the window, or null.</returns>
    /// <response code="200">The status.</response>
    [HttpGet]
    [AllowDuringEnrolment]
    [ProducesResponseType<ConfirmationResponse>(StatusCodes.Status200OK)]
    public async Task<ConfirmationResponse> GetStatus(CancellationToken cancellationToken) =>
        new(User.GetSessionId() is { } sessionId
            ? await sessions.ConfirmedUntilAsync(User.GetUserId(), sessionId, cancellationToken)
            : null);

    /// <summary>Confirms with the password, an authenticator code or a passkey.</summary>
    /// <param name="request">Exactly one of them.</param>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>Until when the confirmation counts.</returns>
    /// <response code="200">Confirmed.</response>
    /// <response code="400">The confirmation is missing, ambiguous or wrong.</response>
    /// <response code="429">The account is locked after too many wrong passwords or codes, or too many requests.</response>
    [HttpPost]
    [AllowDuringEnrolment]
    [EnableRateLimiting(RateLimitPolicies.Authentication)]
    [ProducesResponseType<ConfirmationResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType<ValidationProblemDetails>(StatusCodes.Status400BadRequest)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status429TooManyRequests)]
    public async Task<ConfirmationResponse> Confirm(ConfirmRequest request, CancellationToken cancellationToken)
    {
        var sessionId = User.GetSessionId() ?? throw new ApiValidationException("session", "This session has ended. Sign in again.");
        return new ConfirmationResponse(await confirmations.ConfirmAsync(User.GetUserId(), sessionId, request, cancellationToken));
    }

    /// <summary>Returns options for <c>navigator.credentials.get()</c> to confirm with a passkey, valid for five minutes.</summary>
    /// <returns>The options.</returns>
    /// <response code="200">The options.</response>
    [HttpPost("passkey-options")]
    [AllowDuringEnrolment]
    [ProducesResponseType<PasskeyRequestOptions>(StatusCodes.Status200OK)]
    public PasskeyRequestOptions PasskeyOptions()
    {
        var (rpId, origin) = PasskeySite.Of(Request);
        return passkeys.ConfirmOptions(User.GetUserId(), rpId, origin);
    }
}
