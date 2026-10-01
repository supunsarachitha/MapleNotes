using MapleNotes.Server.Domain;
using MapleNotes.Server.Features.Auth;
using MapleNotes.Server.Features.EndToEnd;
using MapleNotes.Server.Infrastructure.Crypto;
using MapleNotes.Server.Infrastructure.Persistence;
using MapleNotes.Server.Infrastructure.Web;
using Microsoft.EntityFrameworkCore;

namespace MapleNotes.Server.Features.Encryption;

/// <summary>A user's encryption mode and the progress of converting existing content to it.</summary>
/// <param name="Mode">How new notes and attachments are protected.</param>
/// <param name="InProgress">True while existing content is still being converted.</param>
/// <param name="TotalItems">Number of notes, attachments and labels.</param>
/// <param name="RemainingItems">Items not yet converted to match <paramref name="Mode"/>.</param>
public sealed record EncryptionStatusResponse(EncryptionMode Mode, bool InProgress, int TotalItems, int RemainingItems);

/// <summary>Request to change the encryption mode.</summary>
/// <param name="Mode">
/// <see cref="EncryptionMode.Off"/> or <see cref="EncryptionMode.AtRest"/>; also <see cref="EncryptionMode.EndToEnd"/>
/// to switch back while the account still has its end-to-end key (a first switch uses <c>POST /api/v1/account/e2ee</c>).
/// </param>
/// <param name="Proof">Proof of the account password, to confirm a security-relevant change.</param>
public sealed record UpdateEncryptionRequest(EncryptionMode Mode, CredentialProof Proof);

/// <summary>Reads and changes a user's encryption mode.</summary>
/// <param name="db">Database context.</param>
/// <param name="credentials">Checks the proof of the password.</param>
/// <param name="dataKeys">Creates a server-held data key when an account needs one again.</param>
/// <param name="cleanup">Deletes keys the account no longer needs.</param>
/// <param name="signal">Wakes the background migration worker.</param>
/// <param name="time">Clock.</param>
public sealed class EncryptionSettingsService(
    MapleDbContext db,
    CredentialVerifier credentials,
    DataKeyService dataKeys,
    EncryptionKeyCleanup cleanup,
    EncryptionMigrationSignal signal,
    TimeProvider time)
{
    /// <summary>Returns the mode and the conversion progress.</summary>
    /// <param name="userId">The user.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>The status.</returns>
    public async Task<EncryptionStatusResponse> GetStatusAsync(Guid userId, CancellationToken cancellationToken)
    {
        var mode = await db.Users.Where(u => u.Id == userId).Select(u => u.EncryptionMode).SingleAsync(cancellationToken);
        var target = mode switch
        {
            EncryptionMode.Off => ContentScheme.None,
            EncryptionMode.AtRest => ContentScheme.Server,
            _ => ContentScheme.EndToEnd,
        };
        var notes = await db.Notes.CountAsync(n => n.UserId == userId, cancellationToken);
        var attachments = await db.Attachments.CountAsync(a => a.UserId == userId, cancellationToken);
        var labels = await db.Labels.CountAsync(l => l.UserId == userId, cancellationToken);
        var endToEnd = target == ContentScheme.EndToEnd;
        var remaining =
            await db.Notes.CountAsync(n => n.UserId == userId && n.Scheme != target, cancellationToken)
            + await db.Attachments.CountAsync(a => a.UserId == userId && a.Scheme != target, cancellationToken)
            + await db.Labels.CountAsync(l => l.UserId == userId && (endToEnd ? l.Name != null : l.EncryptedName != null), cancellationToken);
        return new EncryptionStatusResponse(mode, remaining > 0, notes + attachments + labels, remaining);
    }

    /// <summary>
    /// Changes the encryption mode after checking proof of the password. New content follows the new mode
    /// immediately. Existing content is converted by the server between off and at rest, and by the browser to and
    /// from end-to-end encryption (see <see cref="ConversionService"/>).
    /// </summary>
    /// <param name="userId">The user.</param>
    /// <param name="request">The new mode and proof of the password.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>The status after the change.</returns>
    /// <exception cref="ApiValidationException">The password is wrong, or end-to-end mode is asked for by an account
    /// without an end-to-end key.</exception>
    public async Task<EncryptionStatusResponse> SetModeAsync(Guid userId, UpdateEncryptionRequest request, CancellationToken cancellationToken)
    {
        if (!Enum.IsDefined(request.Mode))
        {
            throw new ApiValidationException("mode", "Choose off, at rest or end-to-end.");
        }

        var user = await db.Users.SingleAsync(u => u.Id == userId, cancellationToken);
        if (!credentials.Verify(user, request.Proof?.AuthKey, request.Proof?.Password))
        {
            throw new ApiValidationException("password", "The password is not correct.");
        }

        if (request.Mode == EncryptionMode.EndToEnd && user.E2eeWrappedKey is null)
        {
            await db.SaveChangesAsync(cancellationToken); // keeps a legacy credential upgrade
            throw new ApiValidationException("mode", "End-to-end encryption is set up with its own steps in the app.");
        }

        var changed = user.EncryptionMode != request.Mode;
        if (changed)
        {
            user.EncryptionMode = request.Mode;
            if (request.Mode == EncryptionMode.AtRest)
            {
                user.WrappedDataKey ??= dataKeys.CreateWrappedKey(user.Id);
            }

            user.UpdatedAtUtc = time.GetUtcNow().UtcDateTime;
        }

        await db.SaveChangesAsync(cancellationToken); // also keeps a legacy credential upgrade
        await cleanup.RunAsync(userId, cancellationToken);
        if (changed)
        {
            signal.Notify();
        }

        return await GetStatusAsync(userId, cancellationToken);
    }
}
