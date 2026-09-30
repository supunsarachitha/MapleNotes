using MapleNotes.Server.Domain;
using MapleNotes.Server.Features.Auth;
using MapleNotes.Server.Infrastructure.Web;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace MapleNotes.Server.Features.Admin;

/// <summary>Instance administration. Administrators manage settings and accounts but never see note content.</summary>
/// <param name="instanceSettings">Instance settings.</param>
/// <param name="users">Account administration.</param>
[ApiController]
[Route("api/v1/admin")]
[Authorize(Roles = nameof(UserRole.Admin))]
[Produces("application/json")]
public sealed class AdminController(InstanceSettingsService instanceSettings, UserAdministrationService users) : ControllerBase
{
    /// <summary>Returns the instance settings.</summary>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>The settings.</returns>
    /// <response code="200">The settings.</response>
    /// <response code="403">The caller is not an administrator.</response>
    [HttpGet("settings")]
    [ProducesResponseType<InstanceSettingsResponse>(StatusCodes.Status200OK)]
    public async Task<InstanceSettingsResponse> GetSettings(CancellationToken cancellationToken) =>
        new(await instanceSettings.IsRegistrationOpenAsync(cancellationToken), await instanceSettings.GetStorageQuotaMbAsync(cancellationToken));

    /// <summary>Changes the instance settings.</summary>
    /// <param name="request">New values; they replace all the settings.</param>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>The saved settings.</returns>
    /// <response code="200">The saved settings.</response>
    /// <response code="400">The storage limit is out of range.</response>
    [HttpPut("settings")]
    [ProducesResponseType<InstanceSettingsResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType<ValidationProblemDetails>(StatusCodes.Status400BadRequest)]
    public async Task<InstanceSettingsResponse> UpdateSettings(UpdateInstanceSettingsRequest request, CancellationToken cancellationToken)
    {
        if (request.StorageQuotaMb is < 1 or > InstanceSettingsService.MaxStorageQuotaMb)
        {
            throw new ApiValidationException("storageQuotaMb", "Choose a limit from 1 MB to 16 TB, or no limit.");
        }

        await instanceSettings.SaveAsync(request.AllowRegistration, request.StorageQuotaMb, cancellationToken);
        return new InstanceSettingsResponse(request.AllowRegistration, request.StorageQuotaMb);
    }

    /// <summary>Lists all accounts.</summary>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>The accounts, oldest first.</returns>
    /// <response code="200">The accounts.</response>
    [HttpGet("users")]
    [ProducesResponseType<IReadOnlyList<AdminUserResponse>>(StatusCodes.Status200OK)]
    public Task<IReadOnlyList<AdminUserResponse>> ListUsers(CancellationToken cancellationToken) =>
        users.ListUsersAsync(cancellationToken);

    /// <summary>Disables or re-enables an account, or changes its role.</summary>
    /// <param name="id">Account ID.</param>
    /// <param name="request">The changes; omitted fields are unchanged.</param>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>No content.</returns>
    /// <response code="204">The account was updated.</response>
    /// <response code="404">No such account.</response>
    /// <response code="409">Administrators cannot disable or demote themselves.</response>
    [HttpPatch("users/{id:guid}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict)]
    public async Task<IActionResult> UpdateUser(Guid id, UpdateUserRequest request, CancellationToken cancellationToken) =>
        await users.UpdateUserAsync(User.GetUserId(), id, request, cancellationToken) switch
        {
            UserUpdateResult.Updated => NoContent(),
            UserUpdateResult.NotFound => NotFound(),
            _ => Problem(statusCode: StatusCodes.Status409Conflict, title: "You cannot disable or demote your own account."),
        };

    /// <summary>Permanently deletes another account with all of its notes and files.</summary>
    /// <param name="id">Account ID.</param>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>No content.</returns>
    /// <response code="204">The account was deleted.</response>
    /// <response code="404">No such account.</response>
    /// <response code="409">Administrators delete their own account from their settings.</response>
    [HttpDelete("users/{id:guid}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict)]
    public async Task<IActionResult> DeleteUser(Guid id, CancellationToken cancellationToken) =>
        await users.DeleteUserAsync(User.GetUserId(), id, cancellationToken) switch
        {
            UserUpdateResult.Updated => NoContent(),
            UserUpdateResult.NotFound => NotFound(),
            _ => Problem(statusCode: StatusCodes.Status409Conflict, title: "Delete your own account from your settings."),
        };
}
