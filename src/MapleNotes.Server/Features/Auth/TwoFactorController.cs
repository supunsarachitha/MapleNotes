using MapleNotes.Server.Infrastructure.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace MapleNotes.Server.Features.Auth;

/// <summary>Optional two-factor sign-in for the signed-in account: a code from an authenticator app after the password.</summary>
/// <remarks>
/// To turn it on, ask <c>POST setup</c> for a secret, add it to an authenticator app (the web app shows the link as a
/// QR code), then send a code from the app to <c>POST</c>. From then on <c>POST /api/v1/auth/login</c> answers 401
/// with <c>twoFactorRequired: true</c> until the request carries <c>twoFactorCode</c>.
/// </remarks>
/// <param name="twoFactor">Two-factor operations.</param>
[ApiController]
[Route("api/v1/account/two-factor")]
[Produces("application/json")]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class TwoFactorController(TwoFactorService twoFactor) : ControllerBase
{
    /// <summary>Returns whether two-factor sign-in is on and how many recovery codes are left.</summary>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>The status.</returns>
    /// <response code="200">The status.</response>
    [HttpGet]
    [ProducesResponseType<TwoFactorStatusResponse>(StatusCodes.Status200OK)]
    public Task<TwoFactorStatusResponse> GetStatus(CancellationToken cancellationToken) =>
        twoFactor.GetStatusAsync(User.GetUserId(), cancellationToken);

    /// <summary>Creates a new authenticator secret to add to an app. Nothing changes until it is confirmed.</summary>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>The secret and its <c>otpauth://</c> link.</returns>
    /// <response code="200">A new secret.</response>
    [HttpPost("setup")]
    [ProducesResponseType<TwoFactorSetupResponse>(StatusCodes.Status200OK)]
    public Task<TwoFactorSetupResponse> Setup(CancellationToken cancellationToken) =>
        twoFactor.CreateSetupAsync(User.GetUserId(), cancellationToken);

    /// <summary>Turns two-factor sign-in on. Every other session of the account is signed out; this one stays signed in.</summary>
    /// <param name="request">Proof of the password, the secret from setup, and a current code from the app.</param>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>Ten recovery codes, shown only now.</returns>
    /// <response code="200">Two-factor sign-in is on.</response>
    /// <response code="400">The password or code is wrong, the secret is malformed, or it is already on.</response>
    [HttpPost]
    [EnableRateLimiting(RateLimitPolicies.Authentication)]
    [ProducesResponseType<RecoveryCodesResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType<ValidationProblemDetails>(StatusCodes.Status400BadRequest)]
    public async Task<RecoveryCodesResponse> Enable(EnableTwoFactorRequest request, CancellationToken cancellationToken)
    {
        var (user, codes) = await twoFactor.EnableAsync(User.GetUserId(), request, cancellationToken);

        // Same session, same secret, so a key this browser saved under it stays usable; other sessions end.
        var current = await HttpContext.AuthenticateAsync(CookieAuthenticationDefaults.AuthenticationScheme);
        await SessionSignIn.SignInAsync(HttpContext, user, current.Properties?.IsPersistent ?? false, User.GetSessionKey());
        return codes;
    }

    /// <summary>Turns two-factor sign-in off.</summary>
    /// <param name="request">Proof of the password and an authenticator or recovery code.</param>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>No content.</returns>
    /// <response code="204">Two-factor sign-in is off.</response>
    /// <response code="400">The password or code is wrong, or it is already off.</response>
    [HttpDelete]
    [EnableRateLimiting(RateLimitPolicies.Authentication)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType<ValidationProblemDetails>(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> Disable(TwoFactorConfirmation request, CancellationToken cancellationToken)
    {
        await twoFactor.DisableAsync(User.GetUserId(), request, cancellationToken);
        return NoContent();
    }

    /// <summary>Replaces the recovery codes; the old ones stop working.</summary>
    /// <param name="request">Proof of the password and an authenticator or recovery code.</param>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>Ten new recovery codes, shown only now.</returns>
    /// <response code="200">The new codes.</response>
    /// <response code="400">The password or code is wrong, or two-factor sign-in is off.</response>
    [HttpPost("recovery-codes")]
    [EnableRateLimiting(RateLimitPolicies.Authentication)]
    [ProducesResponseType<RecoveryCodesResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType<ValidationProblemDetails>(StatusCodes.Status400BadRequest)]
    public Task<RecoveryCodesResponse> ReplaceRecoveryCodes(TwoFactorConfirmation request, CancellationToken cancellationToken) =>
        twoFactor.ReplaceRecoveryCodesAsync(User.GetUserId(), request, cancellationToken);
}
