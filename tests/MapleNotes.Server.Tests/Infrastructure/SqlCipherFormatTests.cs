using System.Security.Cryptography;
using System.Text;
using MapleNotes.Server.Infrastructure.Persistence;
using MapleNotes.Server.Tests.TestSupport;
using Microsoft.Data.Sqlite;

namespace MapleNotes.Server.Tests.Infrastructure;

/// <summary>
/// Guards the storage guarantee: the database file is encrypted in SQLCipher v4 format and unreadable without the key.
/// </summary>
public sealed class SqlCipherFormatTests : IDisposable
{
    private const string Marker = "maple-secret-marker";
    private readonly TempDirectory _dir = new();
    private readonly byte[] _key = RandomNumberGenerator.GetBytes(SqlCipherConnectionString.KeySizeBytes);
    private readonly string _dbPath;

    public SqlCipherFormatTests()
    {
        _dbPath = _dir.File("maple.db");
        using var connection = Open(_key);
        Execute(connection, "PRAGMA journal_mode=WAL;");
        Execute(connection, "CREATE TABLE notes (id INTEGER PRIMARY KEY, content TEXT NOT NULL);");
        for (var i = 0; i < 50; i++)
        {
            Execute(connection, $"INSERT INTO notes (content) VALUES ('{Marker} {i}');");
        }

        Execute(connection, "PRAGMA wal_checkpoint(TRUNCATE);");
    }

    [Fact]
    public void Uses_the_sqlcipher_cipher_scheme()
    {
        using var connection = Open(_key);
        Assert.Equal("sqlcipher", Scalar(connection, "PRAGMA cipher;"));
    }

    [Fact]
    public void File_on_disk_has_no_sqlite_header_and_no_plaintext()
    {
        var bytes = File.ReadAllBytes(_dbPath);

        Assert.NotEqual("SQLite format 3", Encoding.ASCII.GetString(bytes, 0, 15));
        Assert.DoesNotContain(Marker, Encoding.ASCII.GetString(bytes), StringComparison.Ordinal);
    }

    [Fact]
    public void Correct_key_reads_the_data()
    {
        using var connection = Open(_key);
        Assert.Equal(50L, Scalar(connection, "SELECT count(*) FROM notes;"));
    }

    [Fact]
    public void Wrong_key_is_rejected()
    {
        var wrongKey = RandomNumberGenerator.GetBytes(SqlCipherConnectionString.KeySizeBytes);

        var ex = Assert.Throws<SqliteException>(() =>
        {
            using var connection = Open(wrongKey);
            Scalar(connection, "SELECT count(*) FROM notes;");
        });
        Assert.Equal(26, ex.SqliteErrorCode); // SQLITE_NOTADB: "file is not a database"
    }

    [Fact]
    public void Missing_key_is_rejected()
    {
        var ex = Assert.Throws<SqliteException>(() =>
        {
            using var connection = new SqliteConnection($"Data Source={_dbPath};Pooling=False");
            connection.Open();
            Scalar(connection, "SELECT count(*) FROM notes;");
        });
        Assert.Equal(26, ex.SqliteErrorCode);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(16)]
    [InlineData(64)]
    public void Rejects_keys_that_are_not_256_bits(int length)
    {
        Assert.Throws<ArgumentException>(() => SqlCipherConnectionString.Build(_dbPath, new byte[length]));
    }

    [Theory]
    [InlineData("/app/data/maple.db", "/app/data/maple.db")]
    [InlineData("/tmp/a?b#c%d.db", "/tmp/a%3fb%23c%25d.db")]
    [InlineData(@"C:\Users\me\maple.db", "/C:/Users/me/maple.db")]
    public void Converts_paths_to_sqlite_uri_form(string input, string expected)
    {
        Assert.Equal(expected, SqlCipherConnectionString.ToUriPath(input));
    }

    public void Dispose()
    {
        SqliteConnection.ClearAllPools();
        _dir.Dispose();
    }

    private SqliteConnection Open(byte[] key)
    {
        var connection = new SqliteConnection(SqlCipherConnectionString.Build(_dbPath, key, pooling: false));
        connection.Open();
        return connection;
    }

    private static void Execute(SqliteConnection connection, string sql)
    {
        using var command = connection.CreateCommand();
        command.CommandText = sql;
        command.ExecuteNonQuery();
    }

    private static object? Scalar(SqliteConnection connection, string sql)
    {
        using var command = connection.CreateCommand();
        command.CommandText = sql;
        return command.ExecuteScalar();
    }
}
