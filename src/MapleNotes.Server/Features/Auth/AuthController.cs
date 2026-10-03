using System.Diagnostics;
using System.Globalization;
using MapleNotes.Server.Domain;
using MapleNotes.Server.Features.Admin;
using MapleNotes.Server.Features.EndToEnd;
using MapleNotes.Server.Infrastructure.Configuration;
using MapleNotes.Server.Infrastructure.Web;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace MapleNotes.Server.Features.Auth;

/// <summary>Account sign-up, sign-in and session management.</summary>
/// <remarks>
/// <para>
/// The password never leaves the browser. To sign in, the browser asks <c>POST /api/v1/auth/prelogin</c> for the
/// account's Argon2id parameters, derives an authentication key from the password, and sends only that key
/// (docs/e2ee-spec.md §1). Registration and password changes send a key in the same way.
/// </para>
/// <para>
/// Sessions use an HttpOnly, SameSite=Strict cookie. Every state-changing request (POST, PUT, PATCH, DELETE) must
/// carry the antiforgery token from <c>GET /api/v1/auth/antiforgery</c> in the <c>X-XSRF-TOKEN</c> header; fetch a
/// new token after signing in or out, because tokens are bound to the signed-in user.
/// </para>
/// </remarks>
/// <param name="accounts">Account operations.</param>
/// <param name="instanceSettings">Instance settings.</param>
/// <param name="antiforgery">Antiforgery token service.</param>
/// <param name="time">Clock.</param>
/// <param name="options">Instance settings (whether link previews are allowed).</param>
[ApiController]
[Route("api/v1/auth")]
[Produces("application/json")]
public sealed class AuthController(
    AccountService accounts, InstanceSettingsService instanceSettings, IAntiforgery antiforgery, TimeProvider time, MapleOptions options)
    : ControllerBase
{
    /// <summary>Returns the visitor's sign-in state and what the instance allows.</summary>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>Whether setup is required, whether registration is open, and the signed-in user if any.</returns>
    /// <response code="200">The current state.</response>
    [HttpGet("status")]
    [AllowAnonymous]
    [ProducesResponseType<AuthStatusResponse>(StatusCodes.Status200OK)]
    public async Task<AuthStatusResponse> GetStatus(CancellationToken cancellationToken)
    {
        UserResponse? current = null;
        var persistent = false;
        if (User.Identity?.IsAuthenticated == true && await accounts.FindAsync(User.GetUserId(), cancellationToken) is { } user)
        {
            current = UserResponse.From(user);
            var session = await HttpContext.AuthenticateAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            persistent = session.Properties?.IsPersistent ?? false;
        }

        var setupRequired = await accounts.IsSetupRequiredAsync(cancellationToken);
        var registrationOpen = setupRequired || await instanceSettings.IsRegistrationOpenAsync(cancellationToken);
        var iconVersion = await instanceSettings.GetIconVersionAsync(cancellationToken);
        var branding = new BrandingResponse(
            await instanceSettings.GetAppNameAsync(cancellationToken) ?? InstanceSettingsService.DefaultAppName,
            iconVersion is null ? null : $"/api/v1/branding/icon?v={iconVersion}");
        var version = current is null ? null : typeof(AuthController).Assembly.GetName().Version?.ToString(3);
        return new AuthStatusResponse(setupRequired, registrationOpen, current, options.LinkPreviews, branding, version, persistent);
    }

    /// <summary>Issues an antiforgery token for the current visitor and sets its companion cookie.</summary>
    /// <returns>The token and the header to send it in.</returns>
    /// <response code="200">A token bound to the current visitor.</response>
    [HttpGet("antiforgery")]
    [AllowAnonymous]
    [ProducesResponseType<AntiforgeryTokenResponse>(StatusCodes.Status200OK)]
    public AntiforgeryTokenResponse GetAntiforgeryToken()
    {
        var tokens = antiforgery.GetAndStoreTokens(HttpContext);
        return new AntiforgeryTokenResponse(tokens.RequestToken!, tokens.HeaderName!);
    }

    /// <summary>Returns the key-derivation parameters the browser needs to sign in to an account.</summary>
    /// <remarks>
    /// The answer has the same shape for unknown usernames (default parameters and a stable pseudo-salt), so it does
    /// not reveal which accounts exist. The only exception is <c>upgrade: true</c>, which marks an account created
    /// before version 1.1 until its owner next signs in.
    /// </remarks>
    /// <param name="request">The username.</param>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>The parameters.</returns>
    /// <response code="200">The parameters to derive the authentication key with.</response>
    /// <response code="429">Too many requests from this address; retry later.</response>
    [HttpPost("prelogin")]
    [AllowAnonymous]
    [EnableRateLimiting(RateLimitPolicies.Prelogin)]
    [ProducesResponseType<PreloginResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType<ValidationProblemDetails>(StatusCodes.Status400BadRequest)]
    public Task<PreloginResponse> Prelogin(PreloginRequest request, CancellationToken cancellationToken) =>
        accounts.GetPreloginAsync(request.Username, cancellationToken);

    /// <summary>Creates an account and signs it in. The first account on an instance becomes the administrator.</summary>
    /// <param name="request">Username, key-derivation parameters, authentication key and optional display name.</param>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>The new account.</returns>
    /// <response code="201">The account was created and is signed in.</response>
    /// <response code="400">A field is invalid.</response>
    /// <response code="403">Registration is closed.</response>
    /// <response code="409">The username is taken.</response>
    /// <response code="429">Too many attempts from this address; retry later.</response>
    [HttpPost("register")]
    [AllowAnonymous]
    [EnableRateLimiting(RateLimitPolicies.Authentication)]
    [ProducesResponseType<UserResponse>(StatusCodes.Status201Created)]
    [ProducesResponseType<ValidationProblemDetails>(StatusCodes.Status400BadRequest)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict)]
    public async Task<ActionResult<UserResponse>> Register(RegisterRequest request, CancellationToken cancellationToken)
    {
        var result = await accounts.RegisterAsync(request, cancellationToken);
        switch (result.Error)
        {
            case AccountError.None:
                await SignInAsync(result.User!, isPersistent: false);
                return CreatedAtAction(nameof(GetCurrentUser), UserResponse.From(result.User!));
            case AccountError.InvalidInput:
                return ValidationProblem(new ValidationProblemDetails(result.ValidationErrors!.ToDictionary()));
            case AccountError.RegistrationClosed:
                return Problem(statusCode: StatusCodes.Status403Forbidden, title: "Registration is closed on this instance.");
            case AccountError.UsernameTaken:
                return Problem(statusCode: StatusCodes.Status409Conflict, title: "That username is already taken.");
            default:
                throw new UnreachableException();
        }
    }

    /// <summary>Signs in with a username and the authentication key derived from the password.</summary>
    /// <remarks>After 5 consecutive failures the account is locked for 15 minutes.</remarks>
    /// <param name="request">Credentials and whether to keep the session for 30 days.</param>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>The signed-in account.</returns>
    /// <response code="200">Signed in; the session cookie is set.</response>
    /// <response code="400">The authentication key is malformed.</response>
    /// <response code="401">Unknown username or wrong password.</response>
    /// <response code="403">The account is disabled.</response>
    /// <response code="429">Locked out or rate-limited; see the Retry-After header.</response>
    [HttpPost("login")]
    [AllowAnonymous]
    [EnableRateLimiting(RateLimitPolicies.Authentication)]
    [ProducesResponseType<UserResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType<ValidationProblemDetails>(StatusCodes.Status400BadRequest)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status429TooManyRequests)]
    public async Task<ActionResult<UserResponse>> Login(LoginRequest request, CancellationToken cancellationToken)
    {
        var result = await accounts.ValidateCredentialsAsync(request, cancellationToken);
        switch (result.Error)
        {
            case AccountError.None:
                await SignInAsync(result.User!, request.RememberMe);
                return UserResponse.From(result.User!);
            case AccountError.InvalidInput:
                return ValidationProblem(new ValidationProblemDetails(result.ValidationErrors!.ToDictionary()));
            case AccountError.LockedOut:
                var seconds = Math.Max(1, (int)Math.Ceiling((result.LockedUntilUtc!.Value - time.GetUtcNow().UtcDateTime).TotalSeconds));
                Response.Headers.RetryAfter = seconds.ToString(CultureInfo.InvariantCulture);
                return Problem(
                    statusCode: StatusCodes.Status429TooManyRequests,
                    title: "Too many failed sign-in attempts.",
                    detail: $"Try again in {Math.Ceiling(seconds / 60.0)} minute(s).");
            case AccountError.Disabled:
                return Problem(statusCode: StatusCodes.Status403Forbidden, title: "This account has been disabled by an administrator.");
            default:
                return Problem(statusCode: StatusCodes.Status401Unauthorized, title: "Incorrect username or password.");
        }
    }

    /// <summary>Signs out of the current session.</summary>
    /// <returns>No content.</returns>
    /// <response code="204">Signed out (also returned when not signed in).</response>
    [HttpPost("logout")]
    [AllowAnonymous]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> Logout()
    {
        await HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
        return NoContent();
    }

    /// <summary>Returns the signed-in account.</summary>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>The account.</returns>
    /// <response code="200">The account.</response>
    /// <response code="401">Not signed in.</response>
    [HttpGet("me")]
    [ProducesResponseType<UserResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<ActionResult<UserResponse>> GetCurrentUser(CancellationToken cancellationToken) =>
        await accounts.FindAsync(User.GetUserId(), cancellationToken) is { } user ? UserResponse.From(user) : Unauthorized();

    /// <summary>Changes the password. Every other session of the account is signed out; this one stays signed in.</summary>
    /// <remarks>
    /// The browser proves the current password with its authentication key, then sends the parameters (with a new
    /// salt) and the authentication key of the new password. Password strength rules are applied by the web app.
    /// </remarks>
    /// <param name="request">Proof of the current password; new parameters and authentication key.</param>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>No content.</returns>
    /// <response code="204">The password was changed.</response>
    /// <response code="400">The current password is wrong, or the new parameters or key are invalid.</response>
    [HttpPut("password")]
    [EnableRateLimiting(RateLimitPolicies.Authentication)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType<ValidationProblemDetails>(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> ChangePassword(ChangePasswordRequest request, CancellationToken cancellationToken)
    {
        var result = await accounts.ChangePasswordAsync(User.GetUserId(), request, cancellationToken);
        if (!result.Succeeded)
        {
            return ValidationProblem(new ValidationProblemDetails(result.ValidationErrors!.ToDictionary()));
        }

        // Same session, same secret: the key this browser saved stays usable, while every other session ends.
        var current = await HttpContext.AuthenticateAsync(CookieAuthenticationDefaults.AuthenticationScheme);
        await SessionSignIn.SignInAsync(HttpContext, result.User!, current.Properties?.IsPersistent ?? false, User.GetSessionKey());
        return NoContent();
    }

    /// <summary>Returns this session's secret, which the browser uses to keep its unlocked end-to-end key encrypted.</summary>
    /// <remarks>
    /// The secret lives only in the encrypted, HttpOnly session cookie. A key saved in the browser under it becomes
    /// useless when the session ends, and the server alone has nothing to decrypt. A session from before version 1.1
    /// gets a secret now.
    /// </remarks>
    /// <returns>The secret.</returns>
    /// <response code="200">The secret (never cached).</response>
    /// <response code="401">Not signed in.</response>
    [HttpGet("session-key")]
    [ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
    [ProducesResponseType<SessionKeyResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<SessionKeyResponse> GetSessionKey()
    {
        if (User.GetSessionKey() is not { } sessionKey)
        {
            var current = await HttpContext.AuthenticateAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            var user = await accounts.FindAsync(User.GetUserId(), HttpContext.RequestAborted)
                ?? throw new InvalidOperationException("The signed-in account no longer exists.");
            sessionKey = Convert.ToBase64String(System.Security.Cryptography.RandomNumberGenerator.GetBytes(32));
            await SessionSignIn.SignInAsync(HttpContext, user, current.Properties?.IsPersistent ?? false, sessionKey);
        }

        return new SessionKeyResponse(Convert.FromBase64String(sessionKey));
    }

    /// <summary>Signs out every session of the account, including this one.</summary>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>No content.</returns>
    /// <response code="204">All sessions were ended.</response>
    [HttpPost("sign-out-everywhere")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> SignOutEverywhere(CancellationToken cancellationToken)
    {
        await accounts.RevokeSessionsAsync(User.GetUserId(), cancellationToken);
        await HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
        return NoContent();
    }

    private Task SignInAsync(User user, bool isPersistent) => SessionSignIn.SignInAsync(HttpContext, user, isPersistent);
}
