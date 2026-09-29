using MapleNotes.Server.Features.Auth;
using MapleNotes.Server.Infrastructure.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace MapleNotes.Server.Features.Encryption;

/// <summary>Request to delete the signed-in account.</summary>
/// <param name="Password">The account password, to confirm.</param>
public sealed record DeleteAccountRequest(string Password);

/// <summary>The signed-in user's account: encryption at rest and account deletion.</summary>
/// <param name="accounts">Account operations.</param>
/// <param name="encryption">Encryption-at-rest setting.</param>
[ApiController]
[Route("api/v1/account")]
[Produces("application/json")]
public sealed class AccountController(AccountService accounts, EncryptionSettingsService encryption) : ControllerBase
{
    /// <summary>Returns whether encryption at rest is on and how far converting existing content has progressed.</summary>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>The setting and the progress.</returns>
    /// <response code="200">The status.</response>
    [HttpGet("encryption")]
    [ProducesResponseType<EncryptionStatusResponse>(StatusCodes.Status200OK)]
    public Task<EncryptionStatusResponse> GetEncryption(CancellationToken cancellationToken) =>
        encryption.GetStatusAsync(User.GetUserId(), cancellationToken);

    /// <summary>Switches encryption at rest for notes and attachments on or off.</summary>
    /// <remarks>
    /// Requires the account password. New content follows the new setting immediately; existing notes and files are
    /// converted in the background (poll <c>GET /api/v1/account/encryption</c> for progress). The database itself is
    /// always encrypted, whatever this setting.
    /// </remarks>
    /// <param name="request">The new setting and the password.</param>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>The status after the change.</returns>
    /// <response code="200">The setting was saved; conversion runs in the background.</response>
    /// <response code="400">The password is wrong.</response>
    [HttpPut("encryption")]
    [EnableRateLimiting(RateLimitPolicies.Authentication)]
    [ProducesResponseType<EncryptionStatusResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType<ValidationProblemDetails>(StatusCodes.Status400BadRequest)]
    public Task<EncryptionStatusResponse> SetEncryption(UpdateEncryptionRequest request, CancellationToken cancellationToken) =>
        encryption.SetEnabledAsync(User.GetUserId(), request, cancellationToken);

    /// <summary>Permanently deletes the account with all of its notes and files, then signs out.</summary>
    /// <param name="request">The account password.</param>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>No content.</returns>
    /// <response code="204">The account was deleted.</response>
    /// <response code="400">The password is wrong.</response>
    /// <response code="409">This is the only administrator; appoint another first.</response>
    [HttpDelete]
    [EnableRateLimiting(RateLimitPolicies.Authentication)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType<ValidationProblemDetails>(StatusCodes.Status400BadRequest)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict)]
    public async Task<IActionResult> Delete(DeleteAccountRequest request, CancellationToken cancellationToken)
    {
        var result = await accounts.DeleteOwnAccountAsync(User.GetUserId(), request.Password, cancellationToken);
        switch (result.Error)
        {
            case AccountError.None:
                await HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
                return NoContent();
            case AccountError.LastAdministrator:
                return Problem(
                    statusCode: StatusCodes.Status409Conflict,
                    title: "You are the only administrator.",
                    detail: "Make another account an administrator first, so the instance is never left without one.");
            default:
                return ValidationProblem(new ValidationProblemDetails(result.ValidationErrors!.ToDictionary()));
        }
    }
}
