using MapleNotes.Server.Domain;
using MapleNotes.Server.Features.Admin;
using MapleNotes.Server.Features.Audit;
using MapleNotes.Server.Features.Auth;
using MapleNotes.Server.Infrastructure.Web;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace MapleNotes.Server.Features.Passkeys;

/// <summary>The signed-in account's passkeys: list, add, rename and remove.</summary>
/// <remarks>
/// Adding one takes two requests: <c>POST options</c> returns the options for <c>navigator.credentials.create()</c>,
/// then <c>POST</c> sends the new passkey with proof of the password. The site's host name is the RP ID, so passkeys
/// work only at the address they were added on, over HTTPS (or on <c>localhost</c>).
/// </remarks>
/// <param name="passkeys">Passkey operations.</param>
/// <param name="instanceSettings">Instance settings (the app's name).</param>
/// <param name="audit">The audit log.</param>
[ApiController]
[Route("api/v1/account/passkeys")]
[Produces("application/json")]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class PasskeysController(PasskeyService passkeys, InstanceSettingsService instanceSettings, AuditLog audit) : ControllerBase
{
    /// <summary>Lists the account's passkeys.</summary>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>The passkeys, oldest first.</returns>
    /// <response code="200">The passkeys.</response>
    [HttpGet]
    [AllowDuringEnrolment]
    [ProducesResponseType<IReadOnlyList<PasskeyResponse>>(StatusCodes.Status200OK)]
    public Task<IReadOnlyList<PasskeyResponse>> List(CancellationToken cancellationToken) =>
        passkeys.ListAsync(User.GetUserId(), cancellationToken);

    /// <summary>Returns options to create a passkey, with a challenge valid for five minutes.</summary>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>The options.</returns>
    /// <response code="200">The options.</response>
    /// <response code="400">The account already has the most passkeys allowed.</response>
    [HttpPost("options")]
    [AllowDuringEnrolment]
    [ProducesResponseType<PasskeyCreationOptions>(StatusCodes.Status200OK)]
    [ProducesResponseType<ValidationProblemDetails>(StatusCodes.Status400BadRequest)]
    public async Task<PasskeyCreationOptions> CreateOptions(CancellationToken cancellationToken)
    {
        var appName = await instanceSettings.GetAppNameAsync(cancellationToken) ?? InstanceSettingsService.DefaultAppName;
        var (rpId, origin) = PasskeySite.Of(Request);
        return await passkeys.CreateOptionsAsync(User.GetUserId(), rpId, origin, appName, cancellationToken);
    }

    /// <summary>Adds a passkey.</summary>
    /// <param name="request">Proof of the password, the challenge handle, a name and the new passkey.</param>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>The passkey.</returns>
    /// <response code="201">Added.</response>
    /// <response code="400">The password is wrong, the challenge expired, or the passkey is not valid.</response>
    [HttpPost]
    [AllowDuringEnrolment]
    [EnableRateLimiting(RateLimitPolicies.Authentication)]
    [ProducesResponseType<PasskeyResponse>(StatusCodes.Status201Created)]
    [ProducesResponseType<ValidationProblemDetails>(StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<PasskeyResponse>> Add(AddPasskeyRequest request, CancellationToken cancellationToken)
    {
        var passkey = await passkeys.AddAsync(User.GetUserId(), request, cancellationToken);
        await audit.RecordAsync(AuditEvent.PasskeyAdded, User.Identity?.Name, $"Added the passkey \"{passkey.Name}\".", cancellationToken);
        return StatusCode(StatusCodes.Status201Created, passkey);
    }

    /// <summary>Lets a passkey unlock the end-to-end notes: stores the data key wrapped for it.</summary>
    /// <remarks>
    /// The browser derives the wrapping key from the passkey's PRF output, which never reaches the server
    /// (docs/e2ee-spec.md §6a). Proof of the password is required so that a stolen session cannot store a key of its
    /// own choosing, which the account's browsers would then use for new notes.
    /// </remarks>
    /// <param name="id">The passkey.</param>
    /// <param name="request">Proof of the password and the wrapped key.</param>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>The passkey.</returns>
    /// <response code="200">Stored.</response>
    /// <response code="400">The password is wrong, the account has no end-to-end key, or the key is malformed.</response>
    /// <response code="404">The account has no such passkey.</response>
    [HttpPut("{id:guid}/e2ee")]
    [EnableRateLimiting(RateLimitPolicies.Authentication)]
    [ProducesResponseType<PasskeyResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType<ValidationProblemDetails>(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<PasskeyResponse>> SetUnlockKey(Guid id, PasskeyUnlockRequest request, CancellationToken cancellationToken) =>
        await passkeys.SetUnlockKeyAsync(User.GetUserId(), id, request, cancellationToken) is { } passkey ? passkey : NotFound();

    /// <summary>Lists the passkeys that unlock the notes, with their wrapped keys, for the unlock screen.</summary>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>The keys.</returns>
    /// <response code="200">The keys (empty when no passkey unlocks the notes).</response>
    [HttpGet("e2ee")]
    [ProducesResponseType<IReadOnlyList<PasskeyUnlockKey>>(StatusCodes.Status200OK)]
    public Task<IReadOnlyList<PasskeyUnlockKey>> ListUnlockKeys(CancellationToken cancellationToken) =>
        passkeys.ListUnlockKeysAsync(User.GetUserId(), cancellationToken);

    /// <summary>Renames a passkey.</summary>
    /// <param name="id">The passkey.</param>
    /// <param name="request">The new name.</param>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>The passkey.</returns>
    /// <response code="200">Renamed.</response>
    /// <response code="400">The name is not valid.</response>
    /// <response code="404">The account has no such passkey.</response>
    [HttpPatch("{id:guid}")]
    [ProducesResponseType<PasskeyResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType<ValidationProblemDetails>(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<PasskeyResponse>> Rename(Guid id, RenamePasskeyRequest request, CancellationToken cancellationToken) =>
        await passkeys.RenameAsync(User.GetUserId(), id, request, cancellationToken) is { } passkey ? passkey : NotFound();

    /// <summary>Removes a passkey. Sessions it started stay signed in; use "sign out everywhere" to end them.</summary>
    /// <param name="id">The passkey.</param>
    /// <param name="request">Proof of the password.</param>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>No content.</returns>
    /// <response code="204">Removed.</response>
    /// <response code="400">The password is wrong.</response>
    /// <response code="404">The account has no such passkey.</response>
    [HttpDelete("{id:guid}")]
    [EnableRateLimiting(RateLimitPolicies.Authentication)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType<ValidationProblemDetails>(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Remove(Guid id, RemovePasskeyRequest request, CancellationToken cancellationToken)
    {
        var name = (await passkeys.ListAsync(User.GetUserId(), cancellationToken)).FirstOrDefault(p => p.Id == id)?.Name;
        if (!await passkeys.RemoveAsync(User.GetUserId(), id, request, cancellationToken))
        {
            return NotFound();
        }

        await audit.RecordAsync(AuditEvent.PasskeyRemoved, User.Identity?.Name, $"Removed the passkey \"{name}\".", cancellationToken);
        return NoContent();
    }
}

/// <summary>Signing in with a passkey.</summary>
/// <param name="passkeys">Passkey operations.</param>
/// <param name="audit">The audit log (sign-ins and administrators' actions).</param>
[ApiController]
[Route("api/v1/auth/passkey")]
[Produces("application/json")]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class PasskeySignInController(PasskeyService passkeys, AuditLog audit) : ControllerBase
{
    /// <summary>Returns options for <c>navigator.credentials.get()</c>, with a challenge valid for five minutes.</summary>
    /// <returns>The options. They name no account, so they reveal nothing about which accounts exist.</returns>
    /// <response code="200">The options.</response>
    /// <response code="429">Too many requests from this address; retry later.</response>
    [HttpPost("options")]
    [AllowAnonymous]
    [EnableRateLimiting(RateLimitPolicies.Prelogin)]
    [ProducesResponseType<PasskeyRequestOptions>(StatusCodes.Status200OK)]
    public PasskeyRequestOptions Options()
    {
        var (rpId, origin) = PasskeySite.Of(Request);
        return passkeys.RequestOptions(rpId, origin);
    }

    /// <summary>Signs in with a passkey's answer.</summary>
    /// <remarks>
    /// Passkeys are created and used with user verification (fingerprint, face or PIN), so they count as two factors:
    /// an account with an authenticator app is not asked for its code. Failures do not count toward the password
    /// lockout, since a signature cannot be guessed. End-to-end accounts still need to be unlocked afterwards.
    /// </remarks>
    /// <param name="request">The challenge handle, the answer, and whether to keep the session.</param>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>The signed-in account, the passkey, and the data key wrapped for it when it unlocks the notes.</returns>
    /// <response code="200">Signed in; the session cookie is set.</response>
    /// <response code="401">The passkey is unknown, the challenge expired, or the signature is not valid.</response>
    /// <response code="403">The account is disabled.</response>
    /// <response code="429">Too many attempts from this address; retry later.</response>
    [HttpPost("login")]
    [AllowAnonymous]
    [EnableRateLimiting(RateLimitPolicies.Authentication)]
    [ProducesResponseType<PasskeySignInResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<PasskeySignInResponse>> Login(PasskeyLoginRequest request, CancellationToken cancellationToken)
    {
        var (result, passkey) = await passkeys.SignInAsync(request, cancellationToken);
        var username = result.User?.Username;
        switch (result.Error)
        {
            case AccountError.None:
                await SessionSignIn.SignInAsync(HttpContext, result.User!, request.RememberMe);
                await audit.RecordAsync(AuditEvent.SignIn, username, $"Signed in with the passkey \"{passkey!.Name}\".", cancellationToken, method: "Passkey");
                return new PasskeySignInResponse(UserResponse.From(result.User!), passkey.Id, passkey.E2eeWrappedKey);
            case AccountError.Disabled:
                await audit.RecordAsync(AuditEvent.SignInFailed, username, "The account is disabled.", cancellationToken, method: "Passkey");
                return Problem(statusCode: StatusCodes.Status403Forbidden, title: "This account has been disabled by an administrator.");
            default:
                await audit.RecordAsync(
                    AuditEvent.SignInFailed, username, "The passkey is unknown, or its signature or challenge was not valid.", cancellationToken, method: "Passkey");
                return Problem(statusCode: StatusCodes.Status401Unauthorized, title: "This passkey could not sign you in.");
        }
    }
}

/// <summary>The RP ID and origin of the site a request came to.</summary>
internal static class PasskeySite
{
    /// <summary>Reads them from the request (behind a trusted proxy, from its forwarded headers).</summary>
    /// <param name="request">The request.</param>
    /// <returns>The host name, and the scheme, host and port.</returns>
    public static (string RpId, string Origin) Of(HttpRequest request) =>
        (request.Host.Host.ToLowerInvariant(), $"{request.Scheme}://{request.Host.Value!.ToLowerInvariant()}");
}
