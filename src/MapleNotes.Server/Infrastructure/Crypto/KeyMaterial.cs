using System.Security.Cryptography;
using System.Text;

namespace MapleNotes.Server.Infrastructure.Crypto;

/// <summary>
/// The instance key hierarchy, derived from the master key with HKDF-SHA256 (RFC 5869).
/// </summary>
/// <remarks>
/// <code>
/// MAPLE_MASTER_KEY ──HKDF──┬── database key        SQLCipher raw key for maple.db and its backups
///                          ├── key-encryption key  wraps each user's data key (see DataKeyService)
///                          ├── data-protection key wraps the ASP.NET Core Data Protection key ring on disk
///                          └── fingerprint         8 hex characters, safe to log, identifies which key is loaded
/// </code>
/// Every derived key uses its own HKDF "info" label, so learning one derived key reveals nothing about the others
/// or about the master key. The master key itself is not kept in memory after construction.
/// </remarks>
public sealed class KeyMaterial : IDisposable
{
    private static readonly byte[] Salt = "MapleNotes.KeyDerivation"u8.ToArray();

    private readonly byte[] _databaseKey;
    private readonly byte[] _keyEncryptionKey;
    private readonly byte[] _dataProtectionKey;

    /// <summary>
    /// Derives all keys from <paramref name="masterKey"/>.
    /// </summary>
    /// <param name="masterKey">The 256-bit master key. It is not retained.</param>
    /// <exception cref="ArgumentException">The master key is not 32 bytes long.</exception>
    public KeyMaterial(ReadOnlySpan<byte> masterKey)
    {
        if (masterKey.Length != MasterKey.SizeBytes)
        {
            throw new ArgumentException($"The master key must be {MasterKey.SizeBytes} bytes.", nameof(masterKey));
        }

        _databaseKey = Derive(masterKey, "maple-notes/v1/database", 32);
        _keyEncryptionKey = Derive(masterKey, "maple-notes/v1/key-encryption", 32);
        _dataProtectionKey = Derive(masterKey, "maple-notes/v1/data-protection", 32);

        var fingerprint = Derive(masterKey, "maple-notes/v1/fingerprint", 4);
        Fingerprint = Convert.ToHexStringLower(fingerprint);
    }

    /// <summary>Raw 256-bit key for the SQLCipher database.</summary>
    public ReadOnlySpan<byte> DatabaseKey => _databaseKey;

    /// <summary>256-bit key that wraps (encrypts) per-user data keys.</summary>
    public ReadOnlySpan<byte> KeyEncryptionKey => _keyEncryptionKey;

    /// <summary>256-bit key that wraps the Data Protection key ring stored in the data directory.</summary>
    public ReadOnlySpan<byte> DataProtectionKey => _dataProtectionKey;

    /// <summary>
    /// A short, non-secret identifier of the loaded master key (8 hex characters). Logged at startup so operators
    /// can tell which key an instance runs with without exposing the key.
    /// </summary>
    public string Fingerprint { get; }

    /// <summary>Wipes the derived keys from memory.</summary>
    public void Dispose()
    {
        CryptographicOperations.ZeroMemory(_databaseKey);
        CryptographicOperations.ZeroMemory(_keyEncryptionKey);
        CryptographicOperations.ZeroMemory(_dataProtectionKey);
    }

    private static byte[] Derive(ReadOnlySpan<byte> masterKey, string purpose, int length)
    {
        var output = new byte[length];
        HKDF.DeriveKey(HashAlgorithmName.SHA256, masterKey, output, Salt, Encoding.UTF8.GetBytes(purpose));
        return output;
    }
}
