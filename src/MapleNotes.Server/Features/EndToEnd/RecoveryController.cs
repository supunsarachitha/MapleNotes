using System.Diagnostics;
using MapleNotes.Server.Features.Auth;
using MapleNotes.Server.Infrastructure.Web;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace MapleNotes.Server.Features.EndToEnd;

/// <summary>
/// Password reset with the recovery key of an end-to-end encrypted account (docs/e2ee-spec.md §6). The browser
/// unwraps the data key with the recovery key and re-wraps it under the new password, so the notes stay readable.
/// </summary>
/// <param name="endToEnd">End-to-end key operations.</param>
/// <param name="time">Clock.</param>
[ApiController]
[Route("api/v1/auth/recovery")]
[Produces("application/json")]
[AllowAnonymous]
public sealed class RecoveryController(EndToEndService endToEnd, TimeProvider time) : ControllerBase
{
    private const string WrongKeyTitle = "Incorrect username or recovery key.";

    /// <summary>Checks the recovery key and returns the data key wrapped with it.</summary>
    /// <param name="request">Username and the authentication key derived from the recovery key.</param>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>The account ID and the recovery-wrapped key.</returns>
    /// <response code="200">The recovery key is right.</response>
    /// <response code="401">Unknown username, no recovery key, or a wrong one (deliberately indistinguishable).</response>
    /// <response code="429">Too many attempts from this address; retry later.</response>
    [HttpPost("key")]
    [EnableRateLimiting(RateLimitPolicies.Authentication)]
    [ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
    [ProducesResponseType<RecoveryKeyResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized)]
    public async Task<ActionResult<RecoveryKeyResponse>> GetKey(RecoveryKeyRequest request, CancellationToken cancellationToken) =>
        await endToEnd.GetRecoveryKeyAsync(request, cancellationToken) is { } key
            ? key
            : Problem(statusCode: StatusCodes.Status401Unauthorized, title: WrongKeyTitle);

    /// <summary>
    /// Sets a new password and a new recovery key, signs out every other session and signs this one in.
    /// </summary>
    /// <param name="request">The recovery key being used and the new key material.</param>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>The signed-in account.</returns>
    /// <response code="200">The password was reset; the session cookie is set.</response>
    /// <response code="400">New key material is malformed.</response>
    /// <response code="401">Unknown username, no recovery key, or a wrong one; or a two-factor code is needed or wrong
    /// (<c>twoFactorRequired: true</c>).</response>
    /// <response code="403">The account is disabled.</response>
    /// <response code="429">Too many attempts from this address, or too many wrong two-factor codes; retry later.</response>
    [HttpPost("reset")]
    [EnableRateLimiting(RateLimitPolicies.Authentication)]
    [ProducesResponseType<UserResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType<ValidationProblemDetails>(StatusCodes.Status400BadRequest)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status429TooManyRequests)]
    public async Task<ActionResult<UserResponse>> Reset(ResetWithRecoveryKeyRequest request, CancellationToken cancellationToken)
    {
        var result = await endToEnd.ResetAsync(request, cancellationToken);
        switch (result.Error)
        {
            case AccountError.None:
                await SessionSignIn.SignInAsync(HttpContext, result.User!, isPersistent: false);
                return UserResponse.From(result.User!);
            case AccountError.InvalidInput:
                return ValidationProblem(new ValidationProblemDetails(result.ValidationErrors!.ToDictionary()));
            case AccountError.InvalidCredentials:
                return Problem(statusCode: StatusCodes.Status401Unauthorized, title: WrongKeyTitle);
            case AccountError.Disabled:
                return Problem(statusCode: StatusCodes.Status403Forbidden, title: "This account has been disabled by an administrator.");
            case AccountError.TwoFactorRequired or AccountError.InvalidTwoFactorCode:
                return AuthController.TwoFactorProblem(this, result.Error);
            case AccountError.LockedOut:
                return AuthController.LockedOut(this, result, time);
            default:
                throw new UnreachableException();
        }
    }
}
