using MapleNotes.Server.Infrastructure.Persistence;
using MapleNotes.Server.Infrastructure.Storage;
using Microsoft.EntityFrameworkCore;

namespace MapleNotes.Server.Features.Attachments;

/// <summary>What one cleanup pass removed.</summary>
/// <param name="AbandonedUploads">Uploads never attached to a note within the grace period.</param>
/// <param name="OrphanFiles">Stored files with no database record (for example after a crash).</param>
/// <param name="TemporaryFiles">Leftovers of interrupted writes.</param>
public sealed record AttachmentCleanupResult(int AbandonedUploads, int OrphanFiles, int TemporaryFiles)
{
    /// <summary>Total number of items removed.</summary>
    public int Total => AbandonedUploads + OrphanFiles + TemporaryFiles;
}

/// <summary>Removes attachment data that no longer belongs to anything.</summary>
/// <param name="db">Database context.</param>
/// <param name="store">File store.</param>
/// <param name="time">Clock.</param>
public sealed class AttachmentCleanup(MapleDbContext db, AttachmentStore store, TimeProvider time)
{
    /// <summary>How long an upload may stay unattached (for example while a note is being written).</summary>
    public static readonly TimeSpan AbandonedUploadAge = TimeSpan.FromHours(24);

    /// <summary>
    /// Minimum age of an unreferenced file before it is removed. A file is written before its database record, so
    /// younger files may belong to an upload that is still finishing.
    /// </summary>
    public static readonly TimeSpan OrphanFileAge = TimeSpan.FromHours(1);

    /// <summary>Runs one cleanup pass.</summary>
    /// <param name="cancellationToken">Cancels the pass.</param>
    /// <returns>What was removed.</returns>
    public async Task<AttachmentCleanupResult> RunAsync(CancellationToken cancellationToken)
    {
        var now = time.GetUtcNow().UtcDateTime;

        var abandonedBefore = now - AbandonedUploadAge;
        var abandoned = await db.Attachments
            .Where(a => a.NoteId == null && a.CreatedAtUtc < abandonedBefore)
            .ToListAsync(cancellationToken);
        db.Attachments.RemoveRange(abandoned);
        await db.SaveChangesAsync(cancellationToken);
        foreach (var attachment in abandoned)
        {
            store.Delete(attachment.StorageKey);
        }

        var referenced = (await db.Attachments.Select(a => a.StorageKey).ToListAsync(cancellationToken)).ToHashSet(StringComparer.Ordinal);
        var orphanBefore = now - OrphanFileAge;
        var orphans = 0;
        foreach (var storageKey in store.EnumerateStorageKeys().ToList())
        {
            if (!referenced.Contains(storageKey) && store.GetLastWriteTimeUtc(storageKey) < orphanBefore)
            {
                store.Delete(storageKey);
                orphans++;
            }
        }

        var temporary = store.DeleteStaleTemporaryFiles(OrphanFileAge);
        return new AttachmentCleanupResult(abandoned.Count, orphans, temporary);
    }
}

/// <summary>Runs <see cref="AttachmentCleanup"/> at startup and then every hour.</summary>
/// <param name="scopes">Creates a service scope per pass.</param>
/// <param name="logger">Logger.</param>
internal sealed class AttachmentCleanupService(IServiceScopeFactory scopes, ILogger<AttachmentCleanupService> logger) : BackgroundService
{
    /// <inheritdoc />
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromHours(1));
        do
        {
            try
            {
                await using var scope = scopes.CreateAsyncScope();
                var result = await scope.ServiceProvider.GetRequiredService<AttachmentCleanup>().RunAsync(stoppingToken);
                if (result.Total > 0)
                {
                    logger.LogInformation(
                        "Attachment cleanup removed {Abandoned} abandoned upload(s), {Orphans} orphan file(s) and {Temporary} temporary file(s).",
                        result.AbandonedUploads, result.OrphanFiles, result.TemporaryFiles);
                }
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogError(ex, "Attachment cleanup failed; it will be retried in an hour.");
            }
        }
        while (await timer.WaitForNextTickAsync(stoppingToken));
    }
}
