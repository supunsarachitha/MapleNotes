using MapleNotes.Server.Domain;
using MapleNotes.Server.Features.Audit;
using MapleNotes.Server.Features.Auth;
using MapleNotes.Server.Infrastructure.Persistence;
using MapleNotes.Server.Infrastructure.Web;
using Microsoft.EntityFrameworkCore;

namespace MapleNotes.Server.Features.Admin;

/// <summary>Outcome of an administrator's change to an account.</summary>
public enum UserUpdateResult
{
    /// <summary>The change was saved.</summary>
    Updated,

    /// <summary>No such account.</summary>
    NotFound,

    /// <summary>Administrators cannot disable or demote themselves, which could leave the instance without one.</summary>
    CannotChangeSelf,

    /// <summary>
    /// The change would turn off the last second factor of an account the second-factor rule covers. Nothing was
    /// saved.
    /// </summary>
    LastSecondFactor,
}

/// <summary>Account management for administrators. Administrators never see note content.</summary>
/// <param name="db">Database context.</param>
/// <param name="deletion">Deletes accounts with all their content.</param>
/// <param name="time">Clock.</param>
/// <param name="audit">The audit log (sign-ins and administrators' actions).</param>
/// <param name="settings">Instance settings (the second-factor rule).</param>
public sealed class UserAdministrationService(
    MapleDbContext db, AccountDeletionService deletion, TimeProvider time, AuditLog audit, InstanceSettingsService settings)
{
    /// <summary>Permanently deletes another account with all of its notes and files.</summary>
    /// <param name="actingAdminId">The administrator making the change.</param>
    /// <param name="userId">The account to delete.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>The outcome; administrators delete their own account from their settings instead.</returns>
    public async Task<UserUpdateResult> DeleteUserAsync(Guid actingAdminId, Guid userId, CancellationToken cancellationToken)
    {
        if (userId == actingAdminId)
        {
            return UserUpdateResult.CannotChangeSelf;
        }

        var target = await db.Users.AsNoTracking().Where(u => u.Id == userId).Select(u => u.Username).SingleOrDefaultAsync(cancellationToken);
        if (target is null)
        {
            return UserUpdateResult.NotFound;
        }

        await deletion.DeleteAsync(userId, cancellationToken);
        await audit.RecordAsync(AuditEvent.AccountDeleted, await UsernameAsync(actingAdminId, cancellationToken),
            "Deleted the account, with its notes and files.", cancellationToken, target);
        return UserUpdateResult.Updated;
    }

    /// <summary>Lists all accounts, oldest first.</summary>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>The accounts.</returns>
    public async Task<IReadOnlyList<AdminUserResponse>> ListUsersAsync(CancellationToken cancellationToken) =>
        await db.Users.AsNoTracking()
            .OrderBy(u => u.CreatedAtUtc)
            .Select(u => new AdminUserResponse(
                u.Id, u.Username, u.DisplayName, u.Role, u.IsDisabled,
                db.Notes.Count(n => n.UserId == u.Id), u.CreatedAtUtc, u.TwoFactorSecret != null,
                db.Passkeys.Any(p => p.UserId == u.Id)))
            .ToListAsync(cancellationToken);

    /// <summary>Applies an administrator's changes to an account.</summary>
    /// <param name="actingAdminId">The administrator making the change.</param>
    /// <param name="userId">The account to change.</param>
    /// <param name="request">The changes.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>The outcome.</returns>
    public async Task<UserUpdateResult> UpdateUserAsync(
        Guid actingAdminId, Guid userId, UpdateUserRequest request, CancellationToken cancellationToken)
    {
        if (request.Role is { } requested && !Enum.IsDefined(requested))
        {
            // JSON accepts any number for an enum; an unknown role would demote an administrator past the check below.
            throw new ApiValidationException("role", $"Choose one of: {string.Join(", ", Enum.GetNames<UserRole>())}.");
        }

        if (userId == actingAdminId && (request.IsDisabled == true || request.Role is { } own && own != UserRole.Admin))
        {
            return UserUpdateResult.CannotChangeSelf;
        }

        var user = await db.Users.SingleOrDefaultAsync(u => u.Id == userId, cancellationToken);
        if (user is null)
        {
            return UserUpdateResult.NotFound;
        }

        var changes = new List<string>();
        if (request.IsDisabled is { } disabled && disabled != user.IsDisabled)
        {
            changes.Add(disabled ? "Disabled the account (and signed it out everywhere)." : "Enabled the account.");
            user.IsDisabled = disabled;
            if (disabled)
            {
                user.SecurityStamp = User.NewSecurityStamp(); // ends every session of the user immediately
            }
        }

        if (request.Role is { } role && role != user.Role)
        {
            changes.Add($"Role: {user.Role} → {role}.");
            user.Role = role;
        }

        if (request.TurnOffTwoFactor == true && user.TwoFactorSecret is not null)
        {
            // Judged with the role as it will be after this change, so promoting and turning off at once is refused too.
            if (SecondFactorPolicy.Covers(await settings.GetSecondFactorRuleAsync(cancellationToken), user.Role)
                && !await db.Passkeys.AnyAsync(p => p.UserId == user.Id, cancellationToken))
            {
                return UserUpdateResult.LastSecondFactor;
            }

            changes.Add("Turned off two-factor sign-in.");
            TwoFactorService.Clear(user);
        }

        user.UpdatedAtUtc = time.GetUtcNow().UtcDateTime;
        await db.SaveChangesAsync(cancellationToken);
        if (changes.Count > 0)
        {
            await audit.RecordAsync(
                AuditEvent.AccountChanged, await UsernameAsync(actingAdminId, cancellationToken), string.Join(" ", changes), cancellationToken, user.Username);
        }
        return UserUpdateResult.Updated;
    }

    /// <summary>The acting administrator's username, for the audit log.</summary>
    private Task<string?> UsernameAsync(Guid userId, CancellationToken cancellationToken) =>
        db.Users.AsNoTracking().Where(u => u.Id == userId).Select(u => u.Username).SingleOrDefaultAsync(cancellationToken);
}
