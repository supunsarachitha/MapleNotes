using MapleNotes.Server.Features.Auth;
using MapleNotes.Server.Infrastructure.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace MapleNotes.Server.Features.Encryption;

/// <summary>Request to delete the signed-in account.</summary>
/// <param name="Proof">Proof of the account password, to confirm.</param>
public sealed record DeleteAccountRequest(CredentialProof Proof);

/// <summary>The signed-in user's account: encryption mode and account deletion.</summary>
/// <param name="accounts">Account operations.</param>
/// <param name="encryption">Encryption-at-rest setting.</param>
[ApiController]
[Route("api/v1/account")]
[Produces("application/json")]
public sealed class AccountController(AccountService accounts, EncryptionSettingsService encryption) : ControllerBase
{
    /// <summary>Returns the encryption mode and how far converting existing content has progressed.</summary>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>The setting and the progress.</returns>
    /// <response code="200">The status.</response>
    [HttpGet("encryption")]
    [ProducesResponseType<EncryptionStatusResponse>(StatusCodes.Status200OK)]
    public Task<EncryptionStatusResponse> GetEncryption(CancellationToken cancellationToken) =>
        encryption.GetStatusAsync(User.GetUserId(), cancellationToken);

    /// <summary>Changes the encryption mode of notes and attachments.</summary>
    /// <remarks>
    /// Requires proof of the account password (see <see cref="CredentialProof"/>). New content follows the new mode
    /// immediately. Existing content is converted in the background between off and at rest, and by the app (see
    /// <c>/api/v1/account/conversion</c>) to and from end-to-end encryption; poll <c>GET /api/v1/account/encryption</c>
    /// for progress. The first switch to end-to-end encryption uses <c>POST /api/v1/account/e2ee</c>. The database
    /// itself is always encrypted, whatever this setting.
    /// </remarks>
    /// <param name="request">The new mode and proof of the password.</param>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>The status after the change.</returns>
    /// <response code="200">The mode was saved; conversion runs in the background or in the app.</response>
    /// <response code="400">The password is wrong, or end-to-end mode was asked for without an end-to-end key.</response>
    [HttpPut("encryption")]
    [EnableRateLimiting(RateLimitPolicies.Authentication)]
    [ProducesResponseType<EncryptionStatusResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType<ValidationProblemDetails>(StatusCodes.Status400BadRequest)]
    public Task<EncryptionStatusResponse> SetEncryption(UpdateEncryptionRequest request, CancellationToken cancellationToken) =>
        encryption.SetModeAsync(User.GetUserId(), request, cancellationToken);

    /// <summary>Permanently deletes the account with all of its notes and files, then signs out.</summary>
    /// <param name="request">Proof of the account password.</param>
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
        var result = await accounts.DeleteOwnAccountAsync(User.GetUserId(), request.Proof, cancellationToken);
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
