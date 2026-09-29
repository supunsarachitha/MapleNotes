using MapleNotes.Server.Domain;
using MapleNotes.Server.Features.Auth;
using MapleNotes.Server.Infrastructure.Persistence;
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
}

/// <summary>Account management for administrators. Administrators never see note content.</summary>
/// <param name="db">Database context.</param>
/// <param name="deletion">Deletes accounts with all their content.</param>
/// <param name="time">Clock.</param>
public sealed class UserAdministrationService(MapleDbContext db, AccountDeletionService deletion, TimeProvider time)
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

        if (!await db.Users.AnyAsync(u => u.Id == userId, cancellationToken))
        {
            return UserUpdateResult.NotFound;
        }

        await deletion.DeleteAsync(userId, cancellationToken);
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
                db.Notes.Count(n => n.UserId == u.Id), u.CreatedAtUtc))
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
        if (userId == actingAdminId && (request.IsDisabled == true || request.Role is UserRole.User))
        {
            return UserUpdateResult.CannotChangeSelf;
        }

        var user = await db.Users.SingleOrDefaultAsync(u => u.Id == userId, cancellationToken);
        if (user is null)
        {
            return UserUpdateResult.NotFound;
        }

        if (request.IsDisabled is { } disabled && disabled != user.IsDisabled)
        {
            user.IsDisabled = disabled;
            if (disabled)
            {
                user.SecurityStamp = User.NewSecurityStamp(); // ends every session of the user immediately
            }
        }

        if (request.Role is { } role)
        {
            user.Role = role;
        }

        user.UpdatedAtUtc = time.GetUtcNow().UtcDateTime;
        await db.SaveChangesAsync(cancellationToken);
        return UserUpdateResult.Updated;
    }
}
