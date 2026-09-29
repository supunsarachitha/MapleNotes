using System.Text;
using Microsoft.Data.Sqlite;

namespace MapleNotes.Server.Infrastructure.Persistence;

/// <summary>
/// Builds <see cref="Microsoft.Data.Sqlite"/> connection strings for encrypted, SQLCipher-format databases.
/// </summary>
/// <remarks>
/// <para>
/// Encryption comes from SQLite3 Multiple Ciphers (NuGet <c>SQLite3MC.PCLRaw.bundle</c>, MIT). Its default scheme is
/// ChaCha20-Poly1305, so the URI parameters <c>cipher=sqlcipher&amp;legacy=4</c> select the SQLCipher v4 format
/// instead (AES-256-CBC pages authenticated with HMAC-SHA512). The resulting files open with the official
/// <c>sqlcipher</c> command-line tool, which gives operators an independent recovery path.
/// </para>
/// <para>
/// The key is supplied as a raw 256-bit key (<c>x'…'</c>), which skips SQLCipher's PBKDF2 passphrase stretching.
/// That is safe because the key is derived with HKDF from a high-entropy master key, and it makes each new
/// connection roughly 100x cheaper to open (measured in Phase 0: ~1 ms versus ~150 ms).
/// </para>
/// <para>
/// The returned string contains key material. Never log it or include it in exception messages.
/// </para>
/// </remarks>
internal static class SqlCipherConnectionString
{
    /// <summary>Required database key length in bytes (256 bits).</summary>
    public const int KeySizeBytes = 32;

    /// <summary>
    /// Creates a connection string for the encrypted database at <paramref name="databasePath"/>.
    /// </summary>
    /// <param name="databasePath">Path to the database file; relative paths are resolved against the working directory.</param>
    /// <param name="key">The 256-bit database key.</param>
    /// <param name="pooling">Whether to use connection pooling (on by default; tests turn it off to release files).</param>
    /// <returns>A connection string suitable for <see cref="SqliteConnection"/> or EF Core's <c>UseSqlite</c>.</returns>
    /// <exception cref="ArgumentException">The key is not exactly <see cref="KeySizeBytes"/> bytes long.</exception>
    public static string Build(string databasePath, ReadOnlySpan<byte> key, bool pooling = true)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(databasePath);
        if (key.Length != KeySizeBytes)
        {
            throw new ArgumentException($"The database key must be exactly {KeySizeBytes} bytes.", nameof(key));
        }

        return new SqliteConnectionStringBuilder
        {
            DataSource = $"file:{ToUriPath(Path.GetFullPath(databasePath))}?cipher=sqlcipher&legacy=4",
            Password = $"x'{Convert.ToHexString(key)}'",
            Mode = SqliteOpenMode.ReadWriteCreate,
            Pooling = pooling,
        }.ToString();
    }

    /// <summary>
    /// Converts an absolute file-system path into the path component of an SQLite <c>file:</c> URI.
    /// </summary>
    /// <remarks>
    /// SQLite treats <c>?</c> and <c>#</c> as URI delimiters and decodes <c>%HH</c> escapes, so those characters are
    /// percent-encoded. Windows paths use forward slashes and gain a leading slash (<c>/C:/data/maple.db</c>).
    /// </remarks>
    /// <param name="fullPath">An absolute path.</param>
    /// <returns>The URI-safe path.</returns>
    internal static string ToUriPath(string fullPath)
    {
        var path = fullPath.Replace('\\', '/');
        if (path.Length >= 2 && path[1] == ':')
        {
            path = "/" + path;
        }

        var result = new StringBuilder(path.Length + 8);
        foreach (var c in path)
        {
            result.Append(c switch
            {
                '%' => "%25",
                '?' => "%3f",
                '#' => "%23",
                _ => c.ToString(),
            });
        }

        return result.ToString();
    }
}
