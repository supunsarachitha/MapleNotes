using MapleNotes.Server.Domain;
using MapleNotes.Server.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace MapleNotes.Server.Features.EndToEnd;

/// <summary>
/// Deletes content keys an account no longer needs once a change of encryption mode is complete.
/// </summary>
/// <remarks>
/// In end-to-end mode, the server's own data key is deleted as soon as no server-encrypted item is left: from then on
/// the server holds no key to any of the account's content. Outside end-to-end mode, the end-to-end key material (the
/// wrapped data key and the recovery key) is deleted as soon as no end-to-end item is left. Until then each key stays,
/// because content still depends on it, so an interrupted change never strands content.
/// </remarks>
/// <param name="db">Database context.</param>
public sealed class EncryptionKeyCleanup(MapleDbContext db)
{
    /// <summary>Deletes the keys the account's content no longer needs.</summary>
    /// <param name="userId">The account.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>A task that completes when any key is deleted.</returns>
    public async Task RunAsync(Guid userId, CancellationToken cancellationToken)
    {
        var user = await db.Users.SingleAsync(u => u.Id == userId, cancellationToken);
        if (user.EncryptionMode == EncryptionMode.EndToEnd)
        {
            if (user.WrappedDataKey is not null && !await UsesAsync(userId, ContentScheme.Server, cancellationToken))
            {
                user.WrappedDataKey = null;
            }
        }
        else if (user.E2eeWrappedKey is not null && !await UsesAsync(userId, ContentScheme.EndToEnd, cancellationToken))
        {
            user.E2eeWrappedKey = null;
            user.E2eeRecoveryWrappedKey = null;
            user.E2eeModeRecord = null;
            user.RecoveryKeyHash = null;
        }

        await db.SaveChangesAsync(cancellationToken);
    }

    // Label names are never encrypted by the server: they are plain, or encrypted by the browser.
    private async Task<bool> UsesAsync(Guid userId, ContentScheme scheme, CancellationToken cancellationToken) =>
        await db.Notes.AnyAsync(n => n.UserId == userId && n.Scheme == scheme, cancellationToken)
        || await db.Attachments.AnyAsync(a => a.UserId == userId && a.Scheme == scheme, cancellationToken)
        || (scheme == ContentScheme.EndToEnd && await db.Labels.AnyAsync(l => l.UserId == userId && l.EncryptedName != null, cancellationToken));
}
