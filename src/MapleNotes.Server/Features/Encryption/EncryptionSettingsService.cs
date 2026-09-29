using MapleNotes.Server.Domain;
using MapleNotes.Server.Infrastructure.Persistence;
using MapleNotes.Server.Infrastructure.Web;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace MapleNotes.Server.Features.Encryption;

/// <summary>A user's encryption-at-rest setting and the progress of converting existing content.</summary>
/// <param name="Enabled">Whether note bodies and attachments are (being) encrypted with the user's data key.</param>
/// <param name="InProgress">True while existing content is still being converted in the background.</param>
/// <param name="TotalItems">Number of notes and attachments.</param>
/// <param name="RemainingItems">Items not yet converted to match <paramref name="Enabled"/>.</param>
public sealed record EncryptionStatusResponse(bool Enabled, bool InProgress, int TotalItems, int RemainingItems);

/// <summary>Request to switch encryption at rest on or off.</summary>
/// <param name="Enabled">The new setting.</param>
/// <param name="Password">The account password, to confirm a security-relevant change.</param>
public sealed record UpdateEncryptionRequest(bool Enabled, string Password);

/// <summary>Reads and changes a user's encryption-at-rest setting.</summary>
/// <param name="db">Database context.</param>
/// <param name="passwordHasher">Verifies the confirmation password.</param>
/// <param name="signal">Wakes the background migration worker.</param>
/// <param name="time">Clock.</param>
public sealed class EncryptionSettingsService(
    MapleDbContext db, IPasswordHasher<User> passwordHasher, EncryptionMigrationSignal signal, TimeProvider time)
{
    /// <summary>Returns the setting and the conversion progress.</summary>
    /// <param name="userId">The user.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>The status.</returns>
    public async Task<EncryptionStatusResponse> GetStatusAsync(Guid userId, CancellationToken cancellationToken)
    {
        var enabled = await db.Users.Where(u => u.Id == userId).Select(u => u.EncryptionEnabled).SingleAsync(cancellationToken);
        var notes = await db.Notes.CountAsync(n => n.UserId == userId, cancellationToken);
        var attachments = await db.Attachments.CountAsync(a => a.UserId == userId, cancellationToken);
        var remaining =
            await db.Notes.CountAsync(n => n.UserId == userId && n.IsEncrypted != enabled, cancellationToken)
            + await db.Attachments.CountAsync(a => a.UserId == userId && a.IsEncrypted != enabled, cancellationToken);
        return new EncryptionStatusResponse(enabled, remaining > 0, notes + attachments, remaining);
    }

    /// <summary>
    /// Switches encryption at rest on or off after confirming the password. New content follows the new setting
    /// immediately; existing content is converted in the background.
    /// </summary>
    /// <param name="userId">The user.</param>
    /// <param name="request">The new setting and the password.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>The status after the change.</returns>
    /// <exception cref="ApiValidationException">The password is wrong.</exception>
    public async Task<EncryptionStatusResponse> SetEnabledAsync(Guid userId, UpdateEncryptionRequest request, CancellationToken cancellationToken)
    {
        var user = await db.Users.SingleAsync(u => u.Id == userId, cancellationToken);
        if (passwordHasher.VerifyHashedPassword(user, user.PasswordHash, request.Password ?? string.Empty) == PasswordVerificationResult.Failed)
        {
            throw new ApiValidationException("password", "The password is not correct.");
        }

        if (user.EncryptionEnabled != request.Enabled)
        {
            user.EncryptionEnabled = request.Enabled;
            user.UpdatedAtUtc = time.GetUtcNow().UtcDateTime;
            await db.SaveChangesAsync(cancellationToken);
            signal.Notify();
        }

        return await GetStatusAsync(userId, cancellationToken);
    }
}
