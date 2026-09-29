using MapleNotes.Server.Infrastructure.Persistence;
using MapleNotes.Server.Infrastructure.Storage;
using Microsoft.EntityFrameworkCore;

namespace MapleNotes.Server.Features.Auth;

/// <summary>
/// Permanently deletes an account with all of its notes, tags and files.
/// </summary>
/// <remarks>
/// Deleting the user row also deletes the only stored copy of the account's wrapped data key ("crypto-shredding"):
/// any stray encrypted copy of the account's content, such as a file that could not be removed, can no longer be
/// decrypted. The database runs with <c>secure_delete</c>, so freed pages are overwritten. Backups taken before the
/// deletion still contain the account; they age out with normal backup rotation.
/// </remarks>
/// <param name="db">Database context.</param>
/// <param name="store">Attachment file store.</param>
public sealed class AccountDeletionService(MapleDbContext db, AttachmentStore store)
{
    /// <summary>Deletes the account and everything in it.</summary>
    /// <param name="userId">The account.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>A task that completes when the account and its files are gone.</returns>
    public async Task DeleteAsync(Guid userId, CancellationToken cancellationToken)
    {
        var files = await db.Attachments.Where(a => a.UserId == userId).Select(a => a.StorageKey).ToListAsync(cancellationToken);

        // Foreign keys cascade from the user to notes, attachments, tags and their links.
        await db.Users.Where(u => u.Id == userId).ExecuteDeleteAsync(cancellationToken);

        foreach (var storageKey in files)
        {
            store.Delete(storageKey);
        }
    }
}
