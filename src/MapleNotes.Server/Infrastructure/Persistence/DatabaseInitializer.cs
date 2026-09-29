using System.Text.RegularExpressions;
using MapleNotes.Server.Infrastructure.Configuration;
using MapleNotes.Server.Infrastructure.Crypto;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

namespace MapleNotes.Server.Infrastructure.Persistence;

/// <summary>
/// Brings the database up to date at startup: verifies the key, backs up the database before a schema change, and
/// applies pending migrations.
/// </summary>
/// <param name="db">Database context.</param>
/// <param name="options">Instance settings.</param>
/// <param name="keys">Instance key hierarchy.</param>
/// <param name="time">Clock used to timestamp backups.</param>
/// <param name="logger">Logger.</param>
internal sealed partial class DatabaseInitializer(
    MapleDbContext db, MapleOptions options, KeyMaterial keys, TimeProvider time, ILogger<DatabaseInitializer> logger)
{
    /// <summary>Number of pre-migration backups kept; older ones are deleted.</summary>
    public const int BackupsToKeep = 5;

    private const int SqliteNotADatabase = 26;

    /// <summary>
    /// Verifies the database can be decrypted and applies any pending migrations.
    /// </summary>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>A task that completes when the database is ready.</returns>
    /// <exception cref="MapleStartupException">The database cannot be decrypted with the configured master key.</exception>
    public async Task InitializeAsync(CancellationToken cancellationToken)
    {
        List<string> applied, pending;
        try
        {
            applied = [.. await db.Database.GetAppliedMigrationsAsync(cancellationToken)];
            pending = [.. await db.Database.GetPendingMigrationsAsync(cancellationToken)];
        }
        catch (SqliteException ex) when (ex.SqliteErrorCode == SqliteNotADatabase)
        {
            throw new MapleStartupException(
                $"The database '{options.DatabasePath}' cannot be decrypted with the configured {MasterKey.ValueKey} " +
                $"(key fingerprint {keys.Fingerprint}). Use the key this data directory was created with.", ex);
        }

        if (pending.Count > 0)
        {
            if (applied.Count > 0)
            {
                var backup = BackupDatabase($"before-{pending[0]}");
                logger.LogInformation("Backed up the database to {BackupPath} before applying migrations.", backup);
            }

            logger.LogInformation("Applying {Count} database migration(s): {Migrations}.", pending.Count, string.Join(", ", pending));
            await db.Database.MigrateAsync(cancellationToken);
        }

        // Write-ahead logging lets readers proceed while a write is in progress. The mode is stored in the file.
        await db.Database.ExecuteSqlRawAsync("PRAGMA journal_mode = WAL;", cancellationToken);
    }

    /// <summary>
    /// Copies the live database into the backups directory using SQLite's online backup API. The copy is encrypted
    /// with the same key as the database.
    /// </summary>
    /// <param name="reason">Short label included in the file name.</param>
    /// <returns>Path of the backup file.</returns>
    public string BackupDatabase(string reason)
    {
        Directory.CreateDirectory(options.BackupsDirectory);
        var label = UnsafeFileNameCharacters().Replace(reason, "-");
        var path = Path.Combine(options.BackupsDirectory, $"maple-{time.GetUtcNow():yyyyMMdd-HHmmss}-{label}.db");

        using (var source = new SqliteConnection(SqlCipherConnectionString.Build(options.DatabasePath, keys.DatabaseKey, pooling: false)))
        using (var target = new SqliteConnection(SqlCipherConnectionString.Build(path, keys.DatabaseKey, pooling: false)))
        {
            source.Open();
            target.Open();
            source.BackupDatabase(target);
        }

        PruneBackups();
        return path;
    }

    private void PruneBackups()
    {
        var backups = Directory.GetFiles(options.BackupsDirectory, "maple-*.db")
            .OrderByDescending(Path.GetFileName, StringComparer.Ordinal)
            .Skip(BackupsToKeep);

        foreach (var old in backups)
        {
            File.Delete(old);
        }
    }

    [GeneratedRegex("[^A-Za-z0-9_-]+", RegexOptions.CultureInvariant)]
    private static partial Regex UnsafeFileNameCharacters();
}
