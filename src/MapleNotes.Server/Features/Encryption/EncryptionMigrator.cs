using System.Security.Cryptography;
using System.Text;
using MapleNotes.Server.Domain;
using MapleNotes.Server.Infrastructure.Crypto;
using MapleNotes.Server.Infrastructure.Persistence;
using MapleNotes.Server.Infrastructure.Storage;
using Microsoft.EntityFrameworkCore;

namespace MapleNotes.Server.Features.Encryption;

/// <summary>Outcome of migrating one user's content.</summary>
/// <param name="ProcessedItems">Notes and attachments examined (converted or skipped as damaged).</param>
/// <param name="Completed">False when a concurrent change interrupted the run; it is retried shortly.</param>
public sealed record MigrationRunResult(int ProcessedItems, bool Completed);

/// <summary>
/// Converts a user's existing notes and attachments between <see cref="ContentScheme.None"/> and
/// <see cref="ContentScheme.Server"/> to match their encryption mode (off or at rest).
/// </summary>
/// <remarks>
/// <para>
/// The target follows the user's current <see cref="User.EncryptionMode"/>, re-read before every batch, and every
/// note and attachment records its own <see cref="ContentScheme"/>. The work is therefore resumable and idempotent:
/// after a crash, a restart or the user flipping the setting back mid-way, the next run simply converts whatever does
/// not match yet. End-to-end content, and the content of end-to-end accounts, is left alone: only the owner's browser
/// can convert it.
/// </para>
/// <para>
/// Crash safety. Notes are converted in batches saved in one transaction, so a batch is either fully converted or
/// untouched. An attachment is converted into a new file under a new storage key; only then is its database row
/// switched to the new file and state (a single update), and only after that is the old file deleted. A crash leaves
/// either the old version or the new one in use, never a half-written file; a stray copy is removed by
/// <c>AttachmentCleanup</c>.
/// </para>
/// <para>
/// Concurrent edits are protected by the entities' revision tokens: if the user saves a note while it is being
/// converted, the conversion fails, is discarded, and the note is converted again on the next pass.
/// </para>
/// </remarks>
/// <param name="db">Database context.</param>
/// <param name="keys">Per-scope data keys.</param>
/// <param name="store">Attachment file store.</param>
/// <param name="logger">Logger.</param>
public sealed class EncryptionMigrator(MapleDbContext db, UserContentKeys keys, AttachmentStore store, ILogger<EncryptionMigrator> logger)
{
    /// <summary>Notes converted per transaction.</summary>
    public const int NoteBatchSize = 100;

    /// <summary>Attachments examined per batch.</summary>
    public const int AttachmentBatchSize = 10;

    // Items that cannot be converted (damaged ciphertext or missing file). They are skipped for the rest of this run so
    // one bad item cannot stall the others, and reported in the log.
    private readonly HashSet<Guid> _unconvertible = [];

    /// <summary>
    /// Test hook: runs after an attachment's converted copy has been written and before the database switches to it,
    /// the point where a crash is most delicate.
    /// </summary>
    internal Func<Attachment, Task>? AfterConvertedFileWritten { get; set; }

    /// <summary>
    /// Test hook: runs after a batch of notes has been converted in memory and before it is saved, the window in
    /// which a concurrent edit by the user must not be lost.
    /// </summary>
    internal Func<Task>? BeforeNoteBatchSaved { get; set; }

    /// <summary>Finds users with content the server should convert to match their encryption mode.</summary>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>The user IDs.</returns>
    public async Task<IReadOnlyList<Guid>> FindPendingUsersAsync(CancellationToken cancellationToken) =>
        await db.Users.AsNoTracking()
            .Where(u =>
                (u.EncryptionMode == EncryptionMode.AtRest
                    && (db.Notes.Any(n => n.UserId == u.Id && n.Scheme == ContentScheme.None)
                        || db.Attachments.Any(a => a.UserId == u.Id && a.Scheme == ContentScheme.None)))
                || (u.EncryptionMode == EncryptionMode.Off
                    && (db.Notes.Any(n => n.UserId == u.Id && n.Scheme == ContentScheme.Server)
                        || db.Attachments.Any(a => a.UserId == u.Id && a.Scheme == ContentScheme.Server))))
            .Select(u => u.Id)
            .ToListAsync(cancellationToken);

    /// <summary>Converts all of a user's mismatched notes and attachments, batch by batch.</summary>
    /// <param name="userId">The user.</param>
    /// <param name="cancellationToken">Cancels the run between batches; completed batches stay converted.</param>
    /// <returns>How much was processed and whether the run finished.</returns>
    public async Task<MigrationRunResult> MigrateUserAsync(Guid userId, CancellationToken cancellationToken)
    {
        var processed = 0;
        while (true)
        {
            var mode = await db.Users.AsNoTracking()
                .Where(u => u.Id == userId)
                .Select(u => (EncryptionMode?)u.EncryptionMode)
                .SingleOrDefaultAsync(cancellationToken);
            if (mode is null || ContentSchemes.ServerTarget(mode.Value) is not { } target)
            {
                return new MigrationRunResult(processed, Completed: true); // deleted, or only the browser can convert
            }

            var encrypt = target == ContentScheme.Server;
            var notes = await ConvertNoteBatchAsync(userId, encrypt, cancellationToken);
            if (notes < 0)
            {
                return new MigrationRunResult(processed, Completed: false);
            }

            if (notes > 0)
            {
                processed += notes;
                continue;
            }

            var (attachments, conflicts) = await ConvertAttachmentBatchAsync(userId, encrypt, cancellationToken);
            processed += attachments;
            if (conflicts > 0 && attachments == conflicts)
            {
                return new MigrationRunResult(processed, Completed: false);
            }

            if (attachments == 0)
            {
                return new MigrationRunResult(processed, Completed: true);
            }
        }
    }

    /// <returns>Notes examined, or -1 when a concurrent edit invalidated the batch.</returns>
    private async Task<int> ConvertNoteBatchAsync(Guid userId, bool encrypt, CancellationToken cancellationToken)
    {
        var skip = _unconvertible.ToList();
        var source = encrypt ? ContentScheme.None : ContentScheme.Server;
        var notes = await db.Notes
            .Where(n => n.UserId == userId && n.Scheme == source && !skip.Contains(n.Id))
            .OrderBy(n => n.CreatedAtUtc)
            .Take(NoteBatchSize)
            .ToListAsync(cancellationToken);
        if (notes.Count == 0)
        {
            return 0;
        }

        var key = await keys.GetKeyAsync(userId, cancellationToken);
        foreach (var note in notes)
        {
            string text;
            try
            {
                text = note.Scheme == ContentScheme.Server
                    ? NoteCipher.Decrypt(key, userId, note.Id, note.Content)
                    : Encoding.UTF8.GetString(note.Content);
            }
            catch (CryptographicException ex)
            {
                logger.LogError(ex, "Note {NoteId} cannot be decrypted, so its encryption state cannot be changed. It is left as it is.", note.Id);
                _unconvertible.Add(note.Id);
                continue;
            }

            note.Content = encrypt ? NoteCipher.Encrypt(key, userId, note.Id, text) : Encoding.UTF8.GetBytes(text);
            note.Scheme = encrypt ? ContentScheme.Server : ContentScheme.None;
        }

        if (BeforeNoteBatchSaved is not null)
        {
            await BeforeNoteBatchSaved();
        }

        try
        {
            await db.SaveChangesAsync(cancellationToken);
            return notes.Count;
        }
        catch (DbUpdateConcurrencyException)
        {
            return -1; // someone edited or deleted one of these notes meanwhile; the whole batch is retried later
        }
        finally
        {
            db.ChangeTracker.Clear();
        }
    }

    /// <returns>Attachments examined, and how many of them hit a concurrent change.</returns>
    private async Task<(int Processed, int Conflicts)> ConvertAttachmentBatchAsync(Guid userId, bool encrypt, CancellationToken cancellationToken)
    {
        var skip = _unconvertible.ToList();
        var source = encrypt ? ContentScheme.None : ContentScheme.Server;
        var batch = await db.Attachments
            .Where(a => a.UserId == userId && a.Scheme == source && !skip.Contains(a.Id))
            .OrderBy(a => a.CreatedAtUtc)
            .Take(AttachmentBatchSize)
            .ToListAsync(cancellationToken);
        if (batch.Count == 0)
        {
            return (0, 0);
        }

        var key = await keys.GetKeyAsync(userId, cancellationToken);
        var conflicts = 0;
        try
        {
            foreach (var attachment in batch)
            {
                if (!await ConvertAttachmentAsync(attachment, encrypt, key, cancellationToken))
                {
                    conflicts++;
                }
            }
        }
        finally
        {
            db.ChangeTracker.Clear();
        }

        return (batch.Count, conflicts);
    }

    /// <returns>False when a concurrent change prevented the switch (the new copy is discarded).</returns>
    private async Task<bool> ConvertAttachmentAsync(Attachment attachment, bool encrypt, UserDataKey key, CancellationToken cancellationToken)
    {
        var oldStorageKey = attachment.StorageKey;
        var newStorageKey = AttachmentStore.CreateStorageKey(attachment.Id);

        try
        {
            await using var source = OpenPlaintext(attachment, key);
            await store.WriteAsync(newStorageKey, (file, ct) => encrypt
                ? AttachmentCipher.EncryptAsync(source, file, key, attachment.UserId, attachment.Id, ct)
                : source.CopyToAsync(file, ct), cancellationToken: cancellationToken);
        }
        catch (Exception ex) when (ex is CryptographicException or FileNotFoundException or DirectoryNotFoundException)
        {
            logger.LogError(ex, "Attachment {AttachmentId} cannot be read, so its encryption state cannot be changed. It is left as it is.", attachment.Id);
            _unconvertible.Add(attachment.Id);
            store.Delete(newStorageKey);
            return true;
        }

        if (AfterConvertedFileWritten is not null)
        {
            await AfterConvertedFileWritten(attachment);
        }

        attachment.StorageKey = newStorageKey;
        attachment.Scheme = encrypt ? ContentScheme.Server : ContentScheme.None;
        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            db.Entry(attachment).State = EntityState.Detached;
            store.Delete(newStorageKey);
            return false;
        }

        store.Delete(oldStorageKey);
        return true;
    }

    private Stream OpenPlaintext(Attachment attachment, UserDataKey key)
    {
        var file = store.OpenRead(attachment.StorageKey);
        if (attachment.Scheme == ContentScheme.None)
        {
            return file;
        }

        try
        {
            return DecryptingAttachmentStream.Open(file, key, attachment.UserId, attachment.Id);
        }
        catch
        {
            file.Dispose();
            throw;
        }
    }
}
