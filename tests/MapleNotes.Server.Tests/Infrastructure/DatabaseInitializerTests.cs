using System.Text;
using MapleNotes.Server.Domain;
using MapleNotes.Server.Infrastructure.Configuration;
using MapleNotes.Server.Infrastructure.Crypto;
using MapleNotes.Server.Infrastructure.Persistence;
using MapleNotes.Server.Tests.TestSupport;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.Logging.Abstractions;

namespace MapleNotes.Server.Tests.Infrastructure;

public sealed class DatabaseInitializerTests : IDisposable
{
    private readonly TempDirectory _dir = new();
    private readonly MapleOptions _options;
    private readonly byte[] _masterKey = TestKeys.NewMasterKey();
    private readonly ManualTimeProvider _time = new(new DateTimeOffset(2026, 9, 28, 12, 0, 0, TimeSpan.Zero));

    public DatabaseInitializerTests()
    {
        _options = new MapleOptions { DataDirectory = _dir.Path };
        _options.EnsureDirectories();
    }

    [Fact]
    public async Task Creates_an_encrypted_database_with_the_schema()
    {
        await InitializeAsync(_masterKey);

        using var keys = new KeyMaterial(_masterKey);
        await using var db = CreateContext(keys);
        var tables = await db.Database
            .SqlQueryRaw<string>("SELECT name AS \"Value\" FROM sqlite_master WHERE type = 'table'")
            .ToListAsync(TestContext.Current.CancellationToken);
        var journalMode = await db.Database
            .SqlQueryRaw<string>("SELECT journal_mode AS \"Value\" FROM pragma_journal_mode")
            .SingleAsync(TestContext.Current.CancellationToken);

        Assert.Superset(new HashSet<string> { "Users", "Notes", "Attachments", "Tags", "NoteTags", "InstanceSettings" }, tables.ToHashSet());
        Assert.Equal("wal", journalMode);
        Assert.NotEqual("SQLite format 3", Encoding.ASCII.GetString(File.ReadAllBytes(_options.DatabasePath), 0, 15));
    }

    [Fact]
    public async Task Wrong_master_key_gives_a_clear_startup_error()
    {
        await InitializeAsync(_masterKey);

        var ex = await Assert.ThrowsAsync<MapleStartupException>(() => InitializeAsync(TestKeys.NewMasterKey()));

        Assert.Contains("cannot be decrypted", ex.Message, StringComparison.Ordinal);
        Assert.Contains("fingerprint", ex.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Initialization_is_idempotent_and_takes_no_backup_without_changes()
    {
        await InitializeAsync(_masterKey);
        await InitializeAsync(_masterKey);

        Assert.Empty(Directory.GetFiles(_options.BackupsDirectory));
    }

    [Fact]
    public async Task Backups_are_encrypted_and_restorable()
    {
        await InitializeAsync(_masterKey);
        using var keys = new KeyMaterial(_masterKey);
        await using (var db = CreateContext(keys))
        {
            db.InstanceSettings.Add(new InstanceSetting { Key = "marker", Value = "backup-test" });
            await db.SaveChangesAsync(TestContext.Current.CancellationToken);
        }

        string backupPath;
        await using (var db = CreateContext(keys))
        {
            backupPath = CreateInitializer(db, keys).BackupDatabase("manual test");
        }

        Assert.Matches(@"maple-20260928-120000-manual-test\.db$", backupPath);
        Assert.NotEqual("SQLite format 3", Encoding.ASCII.GetString(File.ReadAllBytes(backupPath), 0, 15));

        await using var restored = new MapleDbContext(new DbContextOptionsBuilder<MapleDbContext>()
            .UseSqlite(SqlCipherConnectionString.Build(backupPath, keys.DatabaseKey, pooling: false)).Options);
        var setting = await restored.InstanceSettings.SingleAsync(TestContext.Current.CancellationToken);
        Assert.Equal("backup-test", setting.Value);
    }

    [Fact]
    public async Task Keeps_only_the_newest_backups()
    {
        await InitializeAsync(_masterKey);
        using var keys = new KeyMaterial(_masterKey);
        await using var db = CreateContext(keys);
        var initializer = CreateInitializer(db, keys);

        var paths = new List<string>();
        for (var i = 0; i < DatabaseInitializer.BackupsToKeep + 2; i++)
        {
            paths.Add(initializer.BackupDatabase("test"));
            _time.Advance(TimeSpan.FromMinutes(1));
        }

        var remaining = Directory.GetFiles(_options.BackupsDirectory).Order().ToArray();
        Assert.Equal(paths.TakeLast(DatabaseInitializer.BackupsToKeep).Order(), remaining);
    }

    [Fact]
    public async Task Upgrading_from_1_0_keeps_password_hashes_and_marks_them_for_upgrade()
    {
        using var keys = new KeyMaterial(_masterKey);
        await using (var v10 = CreateContext(keys))
        {
            await v10.GetService<IMigrator>().MigrateAsync("20260929024608_AddRevisionTokens", TestContext.Current.CancellationToken);
            foreach (var name in new[] { "alice", "bob" })
            {
                // The 1.0 schema, which the current model can no longer write.
                await v10.Database.ExecuteSqlAsync($"""
                    INSERT INTO "Users" ("Id", "Username", "NormalizedUsername", "DisplayName", "PasswordHash", "Role",
                        "WrappedDataKey", "EncryptionEnabled", "SecurityStamp", "AccessFailedCount", "IsDisabled",
                        "CreatedAtUtc", "UpdatedAtUtc")
                    VALUES ({Guid.CreateVersion7().ToString().ToUpperInvariant()}, {name}, {name.ToUpperInvariant()}, {name},
                        {"1.0 hash of " + name}, 'User', {new byte[] { 1, 2, 3 }}, 1, 'STAMP', 0, 0,
                        '2026-09-28 12:00:00', '2026-09-28 12:00:00')
                    """, TestContext.Current.CancellationToken);
            }
        }

        await InitializeAsync(_masterKey);

        await using var db = CreateContext(keys);
        var users = await db.Users.OrderBy(u => u.Username).ToListAsync(TestContext.Current.CancellationToken);
        Assert.Equal(2, users.Count);
        Assert.All(users, user =>
        {
            Assert.Equal(CredentialFormat.LegacyPassword, user.CredentialFormat);
            Assert.Equal("1.0 hash of " + user.Username, user.CredentialHash);
            Assert.Equal(16, user.KdfSalt.Length);
            Assert.Equal((65536, 3, 1), (user.KdfMemoryKiB, user.KdfIterations, user.KdfParallelism));
        });
        Assert.NotEqual(users[0].KdfSalt, users[1].KdfSalt);
        Assert.Single(Directory.GetFiles(_options.BackupsDirectory)); // taken before migrating
    }

    public void Dispose()
    {
        SqliteConnection.ClearAllPools();
        _dir.Dispose();
    }

    private async Task InitializeAsync(byte[] masterKey)
    {
        using var keys = new KeyMaterial(masterKey);
        await using var db = CreateContext(keys);
        await CreateInitializer(db, keys).InitializeAsync(TestContext.Current.CancellationToken);
    }

    private MapleDbContext CreateContext(KeyMaterial keys) =>
        new(new DbContextOptionsBuilder<MapleDbContext>()
            .UseSqlite(SqlCipherConnectionString.Build(_options.DatabasePath, keys.DatabaseKey, pooling: false))
            .Options);

    private DatabaseInitializer CreateInitializer(MapleDbContext db, KeyMaterial keys) =>
        new(db, _options, keys, _time, NullLogger<DatabaseInitializer>.Instance);
}
