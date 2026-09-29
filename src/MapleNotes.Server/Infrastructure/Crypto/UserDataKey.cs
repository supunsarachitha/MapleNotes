using System.Security.Cryptography;

namespace MapleNotes.Server.Infrastructure.Crypto;

/// <summary>
/// An unwrapped per-user data key (256 bits). Dispose it as soon as the operation that needs it completes, which
/// wipes the key bytes from memory.
/// </summary>
public sealed class UserDataKey : IDisposable
{
    private readonly byte[] _key;

    /// <summary>Wraps key bytes; this instance takes ownership of the array.</summary>
    /// <param name="key">The 32 key bytes.</param>
    /// <param name="version">Generation of the key, recorded in everything it encrypts.</param>
    public UserDataKey(byte[] key, byte version)
    {
        if (key.Length != AeadEnvelope.KeySize)
        {
            throw new ArgumentException($"A data key must be {AeadEnvelope.KeySize} bytes.", nameof(key));
        }

        _key = key;
        Version = version;
    }

    /// <summary>The key bytes.</summary>
    public ReadOnlySpan<byte> Span => _key;

    /// <summary>The key bytes, for use across <c>await</c> boundaries.</summary>
    public ReadOnlyMemory<byte> Memory => _key;

    /// <summary>Generation of the key.</summary>
    public byte Version { get; }

    /// <summary>Wipes the key from memory.</summary>
    public void Dispose() => CryptographicOperations.ZeroMemory(_key);
}
