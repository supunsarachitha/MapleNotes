using MapleNotes.Server.Infrastructure.Configuration;
using MapleNotes.Server.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace MapleNotes.Server.Features.Storage;

/// <summary>How much an account stores.</summary>
/// <param name="NotesBytes">Stored size of all its notes' text (as stored: encrypted notes count their ciphertext).</param>
/// <param name="NoteCount">Number of notes, of every kind, archived ones included.</param>
/// <param name="FilesBytes">Size of all its files (end-to-end files count their slightly larger ciphertext).</param>
/// <param name="FileCount">Number of files, including uploads not yet attached to a note.</param>
public sealed record StorageUsageResponse(long NotesBytes, int NoteCount, long FilesBytes, int FileCount)
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

/// <summary>
/// Measures storage: an account's own usage, from the database (sizes are metadata the server has in every encryption
/// mode), and for administrators the whole instance's, from the files on its data volume. Administrators get totals
/// only, never another account's usage: like its notes, how much a person stores is theirs.
/// </summary>
/// <param name="db">Database context.</param>
/// <param name="options">Where the data lives.</param>
public sealed class StorageService(MapleDbContext db, MapleOptions options)
{
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

        var database = new[] { options.DatabasePath, options.DatabasePath + "-wal" }.Where(File.Exists).Sum(path => new FileInfo(path).Length);
        return new InstanceStorageResponse(database, DirectorySize(options.AttachmentsDirectory), DirectorySize(options.BackupsDirectory), free);
    }

    private static long DirectorySize(string path) =>
        Directory.Exists(path)
            ? new DirectoryInfo(path).EnumerateFiles("*", SearchOption.AllDirectories).Sum(file => file.Length)
            : 0;
}
