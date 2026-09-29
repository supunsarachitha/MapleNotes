using MapleNotes.Server.Features.Auth;
using MapleNotes.Server.Features.Encryption;
using MapleNotes.Server.Infrastructure.Web;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace MapleNotes.Server.Features.EndToEnd;

/// <summary>The signed-in account's end-to-end encryption key material (docs/e2ee-spec.md).</summary>
/// <param name="endToEnd">End-to-end key operations.</param>
[ApiController]
[Route("api/v1/account/e2ee")]
[Produces("application/json")]
public sealed class EndToEndController(EndToEndService endToEnd) : ControllerBase
{
    /// <summary>Returns the account's end-to-end data key, wrapped with the key derived from the password.</summary>
    /// <remarks>The browser unwraps it after deriving the wrapping key from the password; the server cannot.</remarks>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>The wrapped key.</returns>
    /// <response code="200">The wrapped key (never cached).</response>
    /// <response code="404">The account has no end-to-end key.</response>
    [HttpGet]
    [ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
    [ProducesResponseType<E2eeKeyResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<E2eeKeyResponse>> GetKey(CancellationToken cancellationToken) =>
        await endToEnd.GetWrappedKeyAsync(User.GetUserId(), cancellationToken) is { } wrapped
            ? new E2eeKeyResponse(wrapped)
            : NotFound();

    /// <summary>Switches the account to end-to-end encryption with a data key created in the browser.</summary>
    /// <remarks>
    /// From now on the server accepts only encrypted notes and files for this account. Existing content stays
    /// readable; the app converts it and reports progress through <c>GET /api/v1/account/encryption</c>.
    /// </remarks>
    /// <param name="request">Proof of the password, the wrapped data key and the recovery material.</param>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>The encryption status afterwards.</returns>
    /// <response code="200">End-to-end encryption is on.</response>
    /// <response code="400">The password is wrong or a key is malformed.</response>
    /// <response code="409">The account already has an end-to-end key.</response>
    [HttpPost]
    [EnableRateLimiting(RateLimitPolicies.Authentication)]
    [ProducesResponseType<EncryptionStatusResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType<ValidationProblemDetails>(StatusCodes.Status400BadRequest)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict)]
    public Task<EncryptionStatusResponse> Enable(EnableEndToEndRequest request, CancellationToken cancellationToken) =>
        endToEnd.EnableAsync(User.GetUserId(), request, cancellationToken);

    /// <summary>Replaces the recovery key. The previous recovery key stops working.</summary>
    /// <param name="request">Proof of the password and the new recovery material.</param>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>No content.</returns>
    /// <response code="204">The new recovery key is in place.</response>
    /// <response code="400">The password is wrong or a key is malformed.</response>
    /// <response code="409">The account has no end-to-end key.</response>
    [HttpPut("recovery")]
    [EnableRateLimiting(RateLimitPolicies.Authentication)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType<ValidationProblemDetails>(StatusCodes.Status400BadRequest)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict)]
    public async Task<IActionResult> ReplaceRecoveryKey(ReplaceRecoveryKeyRequest request, CancellationToken cancellationToken)
    {
        await endToEnd.ReplaceRecoveryKeyAsync(User.GetUserId(), request, cancellationToken);
        return NoContent();
    }
}
