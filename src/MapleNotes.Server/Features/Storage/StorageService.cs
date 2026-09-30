using MapleNotes.Server.Infrastructure.Configuration;
using MapleNotes.Server.Infrastructure.Persistence;
using MapleNotes.Server.Infrastructure.Web;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

namespace MapleNotes.Server.Features.Storage;

/// <summary>How much an account stores.</summary>
/// <param name="NotesBytes">Stored size of all its notes' text (as stored: encrypted notes count their ciphertext).</param>
/// <param name="NoteCount">Number of notes, of every kind, archived ones included.</param>
/// <param name="FilesBytes">Size of all its files (end-to-end files count their slightly larger ciphertext).</param>
/// <param name="FileCount">Number of files, including uploads not yet attached to a note.</param>
/// <param name="QuotaBytes">The most the account may store, notes and files together, as set by an administrator; null
/// when there is no limit.</param>
public sealed record StorageUsageResponse(long NotesBytes, int NoteCount, long FilesBytes, int FileCount, long? QuotaBytes = null)
{
    /// <summary>Notes and files together.</summary>
    public long TotalBytes => NotesBytes + FilesBytes;
}

/// <summary>What the instance stores on its data volume, and the space left there.</summary>
/// <param name="DatabaseBytes">The encrypted database, with its write-ahead log.</param>
/// <param name="FilesBytes">All attachment files.</param>
/// <param name="BackupsBytes">Automatic and manual database backups.</param>
/// <param name="FreeBytes">Free space on the volume holding the data directory, or null when unknown.</param>
public sealed record InstanceStorageResponse(long DatabaseBytes, long FilesBytes, long BackupsBytes, long? FreeBytes)
{
    /// <summary>Everything Maple Notes stores.</summary>
    public long TotalBytes => DatabaseBytes + FilesBytes + BackupsBytes;
}

/// <summary>The database's size before and after compacting it.</summary>
/// <param name="BytesBefore">The database and its write-ahead log before.</param>
/// <param name="BytesAfter">The same after.</param>
public sealed record CompactDatabaseResponse(long BytesBefore, long BytesAfter);

/// <summary>
/// Measures storage: an account's own usage, from the database (sizes are metadata the server has in every encryption
/// mode), and for administrators the whole instance's, from the files on its data volume. Administrators get totals
/// only, never another account's usage: like its notes, how much a person stores is theirs.
/// </summary>
/// <param name="db">Database context.</param>
/// <param name="options">Where the data lives.</param>
public sealed class StorageService(MapleDbContext db, MapleOptions options)
{
    private static readonly SemaphoreSlim CompactGate = new(1, 1);

    /// <summary>Returns how much an account stores.</summary>
    /// <param name="userId">The account.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>Its usage.</returns>
    public async Task<StorageUsageResponse> GetUsageAsync(Guid userId, CancellationToken cancellationToken)
    {
        var notes = await db.Notes.AsNoTracking().Where(n => n.UserId == userId)
            .GroupBy(_ => 1)
            .Select(g => new { Bytes = g.Sum(n => (long)n.Content.Length), Count = g.Count() })
            .SingleOrDefaultAsync(cancellationToken);
        var files = await db.Attachments.AsNoTracking().Where(a => a.UserId == userId)
            .GroupBy(_ => 1)
            .Select(g => new { Bytes = g.Sum(a => a.SizeBytes), Count = g.Count() })
            .SingleOrDefaultAsync(cancellationToken);
        return new StorageUsageResponse(notes?.Bytes ?? 0, notes?.Count ?? 0, files?.Bytes ?? 0, files?.Count ?? 0);
    }

    /// <summary>Measures the instance's data volume.</summary>
    /// <returns>What Maple Notes stores there, and the free space.</returns>
    public InstanceStorageResponse GetInstanceStorage()
    {
        long? free;
        try
        {
            free = new DriveInfo(options.DataDirectory).AvailableFreeSpace;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException)
        {
            free = null;
        }

        return new InstanceStorageResponse(DatabaseSize(), DirectorySize(options.AttachmentsDirectory), DirectorySize(options.BackupsDirectory), free);
    }

    /// <summary>
    /// Rebuilds the database without the space deleted notes and files left behind (SQLite <c>VACUUM</c>, which keeps
    /// the encryption), then truncates the write-ahead log, so the space goes back to the volume. Deleted content is
    /// already overwritten (<c>secure_delete</c>); this only shrinks the file.
    /// </summary>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>The size before and after.</returns>
    /// <exception cref="ApiProblemException">A compaction is already running, or the database stays busy (HTTP 409).</exception>
    public async Task<CompactDatabaseResponse> CompactDatabaseAsync(CancellationToken cancellationToken)
    {
        if (!await CompactGate.WaitAsync(0, cancellationToken))
        {
            throw new ApiProblemException(StatusCodes.Status409Conflict, "The database is already being compacted.");
        }

        try
        {
            var before = DatabaseSize();
            db.Database.SetCommandTimeout(TimeSpan.FromMinutes(10));
            await db.Database.ExecuteSqlRawAsync("VACUUM;", cancellationToken);
            await db.Database.ExecuteSqlRawAsync("PRAGMA wal_checkpoint(TRUNCATE);", cancellationToken);
            return new CompactDatabaseResponse(before, DatabaseSize());
        }
        catch (SqliteException ex) when (ex.SqliteErrorCode is 5 or 6) // SQLITE_BUSY, SQLITE_LOCKED
        {
            throw new ApiProblemException(StatusCodes.Status409Conflict, "The database is busy.", "Try again in a moment.");
        }
        finally
        {
            CompactGate.Release();
        }
    }

    private long DatabaseSize() =>
        new[] { options.DatabasePath, options.DatabasePath + "-wal" }.Where(File.Exists).Sum(path => new FileInfo(path).Length);

    private static long DirectorySize(string path) =>
        Directory.Exists(path)
            ? new DirectoryInfo(path).EnumerateFiles("*", SearchOption.AllDirectories).Sum(file => file.Length)
            : 0;
}
