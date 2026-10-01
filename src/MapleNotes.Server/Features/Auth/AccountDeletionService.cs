using MapleNotes.Server.Infrastructure.Persistence;
using MapleNotes.Server.Infrastructure.Storage;
using Microsoft.EntityFrameworkCore;

namespace MapleNotes.Server.Features.Auth;

/// <summary>What deleting an account's content removed.</summary>
/// <param name="Notes">Notes of every kind, archived ones included.</param>
/// <param name="Files">Files, including uploads not yet attached to a note.</param>
public sealed record DeletedContentResponse(int Notes, int Files);

/// <summary>
/// Permanently deletes an account with all of its notes, tags and files, or only its content.
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

        // Foreign keys cascade from the user to notes, attachments, tags, labels and their links.
        await db.Users.Where(u => u.Id == userId).ExecuteDeleteAsync(cancellationToken);

        foreach (var storageKey in files)
        {
            store.Delete(storageKey);
        }
    }

    /// <summary>
    /// Deletes all of an account's notes, tags, labels and files, and keeps the account itself: its sign-in details,
    /// encryption keys, settings and sessions.
    /// </summary>
    /// <param name="userId">The account.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>How many notes and files were deleted.</returns>
    public async Task<DeletedContentResponse> DeleteContentAsync(Guid userId, CancellationToken cancellationToken)
    {
        List<string> files;
        int notes;
        await using (var transaction = await db.Database.BeginTransactionAsync(cancellationToken))
        {
            files = await db.Attachments.Where(a => a.UserId == userId).Select(a => a.StorageKey).ToListAsync(cancellationToken);
            await db.Attachments.Where(a => a.UserId == userId).ExecuteDeleteAsync(cancellationToken);
            notes = await db.Notes.Where(n => n.UserId == userId).ExecuteDeleteAsync(cancellationToken); // with their tag links
            await db.Tags.Where(t => t.UserId == userId).ExecuteDeleteAsync(cancellationToken);
            await db.Labels.Where(l => l.UserId == userId).ExecuteDeleteAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }

        foreach (var storageKey in files)
        {
            store.Delete(storageKey);
        }

        return new DeletedContentResponse(notes, files.Count);
    }
}
