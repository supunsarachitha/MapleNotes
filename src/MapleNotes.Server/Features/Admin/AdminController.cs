using MapleNotes.Server.Domain;
using MapleNotes.Server.Features.Audit;
using MapleNotes.Server.Features.Auth;
using MapleNotes.Server.Infrastructure.Web;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace MapleNotes.Server.Features.Admin;

/// <summary>Instance administration. Administrators manage settings and accounts but never see note content.</summary>
/// <param name="instanceSettings">Instance settings.</param>
/// <param name="users">Account administration.</param>
/// <param name="audit">The audit log (sign-ins and administrators' actions).</param>
/// <param name="secondFactor">The second-factor rule.</param>
/// <param name="accounts">Account lookups.</param>
[ApiController]
[Route("api/v1/admin")]
[Authorize(Roles = nameof(UserRole.Admin))]
[Produces("application/json")]
public sealed class AdminController(
    InstanceSettingsService instanceSettings, UserAdministrationService users, AuditLog audit, SecondFactorPolicy secondFactor,
    AccountService accounts) : ControllerBase
{
    /// <summary>Returns the instance settings.</summary>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>The settings.</returns>
    /// <response code="200">The settings.</response>
    /// <response code="403">The caller is not an administrator.</response>
    [HttpGet("settings")]
    [ProducesResponseType<InstanceSettingsResponse>(StatusCodes.Status200OK)]
    public async Task<InstanceSettingsResponse> GetSettings(CancellationToken cancellationToken) =>
        new(
            await instanceSettings.IsRegistrationOpenAsync(cancellationToken),
            await instanceSettings.GetStorageQuotaMbAsync(cancellationToken),
            await instanceSettings.GetAppNameAsync(cancellationToken),
            await instanceSettings.GetSessionDaysAsync(cancellationToken),
            await instanceSettings.GetSecondFactorRuleAsync(cancellationToken));

    /// <summary>Changes the instance settings.</summary>
    /// <param name="request">New values; they replace all the settings.</param>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>The saved settings.</returns>
    /// <response code="200">The saved settings.</response>
    /// <response code="400">The storage limit or session length is out of range, the app name is too long or not on
    /// one line, or the second-factor rule is unknown.</response>
    /// <response code="409">The second-factor rule would cover the administrator saving it, who has no second factor
    /// yet.</response>
    [HttpPut("settings")]
    [ProducesResponseType<InstanceSettingsResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType<ValidationProblemDetails>(StatusCodes.Status400BadRequest)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict)]
    public async Task<ActionResult<InstanceSettingsResponse>> UpdateSettings(UpdateInstanceSettingsRequest request, CancellationToken cancellationToken)
    {
        if (request.StorageQuotaMb is < 1 or > InstanceSettingsService.MaxStorageQuotaMb)
        {
            throw new ApiValidationException("storageQuotaMb", "Choose a limit from 1 MB to 16 TB, or no limit.");
        }

        if (!InstanceSettingsService.TryNormalizeAppName(request.AppName, out var appName))
        {
            throw new ApiValidationException("appName", $"Use at most {InstanceSettingsService.MaxAppNameLength} characters, on one line.");
        }

        if (request.SessionDays is < 1 or > InstanceSettingsService.MaxSessionDays)
        {
            throw new ApiValidationException("sessionDays", $"Choose from 1 to {InstanceSettingsService.MaxSessionDays} days.");
        }

        if (request.RequireSecondFactor is { } requested && !Enum.IsDefined(requested))
        {
            // JSON accepts any number for an enum; an unknown value would be saved and then read back as Off.
            throw new ApiValidationException("requireSecondFactor", $"Choose one of: {string.Join(", ", Enum.GetNames<SecondFactorRule>())}.");
        }

        var sessionDays = request.SessionDays ?? InstanceSettingsService.DefaultSessionDays;
        var before = await GetSettings(cancellationToken);
        var rule = request.RequireSecondFactor ?? before.RequireSecondFactor;
        if (rule != before.RequireSecondFactor && SecondFactorPolicy.Covers(rule, UserRole.Admin)
            && (await accounts.FindAsync(User.GetUserId(), cancellationToken) is not { } self
                || !await secondFactor.HasSecondFactorAsync(self, cancellationToken)))
        {
            // Otherwise saving would restrict the administrator's own session at once.
            return Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "Set up two-factor sign-in or a passkey on your own account first.");
        }

        await instanceSettings.SaveAsync(request.AllowRegistration, request.StorageQuotaMb, appName, sessionDays, rule, cancellationToken);
        var after = new InstanceSettingsResponse(request.AllowRegistration, request.StorageQuotaMb, appName, sessionDays, rule);
        if (SettingsChanges(before, after) is { Length: > 0 } changes)
        {
            await audit.RecordAsync(AuditEvent.SettingsChanged, User.Identity?.Name, changes, cancellationToken);
        }

        return after;
    }

    /// <summary>Checks the audit log's hash chain and names the first entry that was changed or follows a deleted one.</summary>
    /// <remarks>
    /// Each entry carries an HMAC of the previous entry's hash and its own content, under a key derived from the master
    /// key, so changes made directly in the database show here. Entries written before version 1.22 are not covered.
    /// </remarks>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>Whether the chain is intact, and where it breaks.</returns>
    /// <response code="200">The result.</response>
    [HttpGet("audit/verify")]
    [ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
    [ProducesResponseType<AuditVerifyResponse>(StatusCodes.Status200OK)]
    public Task<AuditVerifyResponse> VerifyAudit(CancellationToken cancellationToken) => audit.VerifyAsync(cancellationToken);

    /// <summary>Lists the audit log, newest first.</summary>
    /// <remarks>Filters: <c>All</c>, <c>SignIns</c>, <c>FailedSignIns</c>, <c>Admin</c> (administrators' actions) and
    /// <c>Security</c> (people's changes to their own password, two-factor sign-in, passkeys, recovery key and
    /// encryption, and "sign out everywhere").</remarks>
    /// <param name="filter">Which entries.</param>
    /// <param name="before">The previous page's <c>nextCursor</c>.</param>
    /// <param name="limit">Page size, 1 to 100.</param>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>A page of entries. Entries are kept for 180 days.</returns>
    /// <response code="200">The entries.</response>
    [HttpGet("audit")]
    [ProducesResponseType<AuditPageResponse>(StatusCodes.Status200OK)]
    public Task<AuditPageResponse> ListAudit(
        AuditFilter filter = AuditFilter.All, long? before = null, int limit = 50, CancellationToken cancellationToken = default) =>
        audit.ListAsync(filter, before, limit, cancellationToken);

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
    /// <response code="409">Administrators cannot disable or demote themselves, nor turn off two-factor sign-in for an
    /// account the second-factor rule covers that has no passkey.</response>
    [HttpPatch("users/{id:guid}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict)]
    public async Task<IActionResult> UpdateUser(Guid id, UpdateUserRequest request, CancellationToken cancellationToken) =>
        await users.UpdateUserAsync(User.GetUserId(), id, request, cancellationToken) switch
        {
            UserUpdateResult.Updated => NoContent(),
            UserUpdateResult.NotFound => NotFound(),
            UserUpdateResult.LastSecondFactor => Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "This server requires a second factor for this account, and two-factor sign-in is its only one.",
                detail: "Change who must use a second factor in the settings first, or let the owner add a passkey."),
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

    /// <summary>The changed settings in a sentence ("Registration: closed → open. Sessions: 30 → 14 days."), or "".</summary>
    /// <param name="before">The settings before.</param>
    /// <param name="after">The settings after.</param>
    /// <returns>The changes.</returns>
    internal static string SettingsChanges(InstanceSettingsResponse before, InstanceSettingsResponse after)
    {
        static string Open(bool open) => open ? "open" : "closed";
        static string Quota(int? mb) => mb is { } value ? $"{value} MB" : "no limit";
        static string Rule(SecondFactorRule rule) => rule switch
        {
            SecondFactorRule.Administrators => "administrators",
            SecondFactorRule.Everyone => "everyone",
            _ => "nobody",
        };
        static string Name(string? name) => string.IsNullOrEmpty(name) ? "the default" : $"\"{name}\"";
        var changes = new List<string>();
        if (before.AllowRegistration != after.AllowRegistration)
        {
            changes.Add($"Registration: {Open(before.AllowRegistration)} → {Open(after.AllowRegistration)}.");
        }

        if (before.StorageQuotaMb != after.StorageQuotaMb)
        {
            changes.Add($"Storage limit: {Quota(before.StorageQuotaMb)} → {Quota(after.StorageQuotaMb)}.");
        }

        if (before.AppName != after.AppName)
        {
            changes.Add($"App name: {Name(before.AppName)} → {Name(after.AppName)}.");
        }

        if (before.SessionDays != after.SessionDays)
        {
            changes.Add($"Sessions last: {before.SessionDays} → {after.SessionDays} days.");
        }

        if (before.RequireSecondFactor != after.RequireSecondFactor)
        {
            changes.Add($"Second factor required for: {Rule(before.RequireSecondFactor)} → {Rule(after.RequireSecondFactor)}.");
        }

        return string.Join(" ", changes);
    }
}
