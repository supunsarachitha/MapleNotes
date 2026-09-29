using System.Security.Cryptography;

namespace MapleNotes.Server.Infrastructure.Crypto;

/// <summary>
/// Authenticated encryption (AES-256-GCM) for small, whole-in-memory payloads: note bodies, wrapped user keys and
/// the Data Protection key ring. Attachments use the streaming <see cref="AttachmentCipher"/> instead.
/// </summary>
/// <remarks>
/// <para>Envelope layout, in bytes:</para>
/// <code>
/// [0]      format version (currently 1)
/// [1]      key version: which generation of the key encrypted this payload (enables future key rotation)
/// [2..13]  nonce, 96 random bits per message
/// [14..29] authentication tag, 128 bits
/// [30..]   ciphertext, same length as the plaintext
/// </code>
/// <para>
/// The two header bytes are authenticated together with the caller's associated data, so neither can be changed
/// without detection. Callers bind each payload to its owner (for example user and note IDs) through the associated
/// data, which stops ciphertext from being copied between rows. Random 96-bit nonces are safe for up to 2^32
/// messages per key (NIST SP 800-38D), far more than one user's notes.
/// </para>
/// </remarks>
internal static class AeadEnvelope
{
    /// <summary>Current envelope format version.</summary>
    public const byte FormatVersion = 1;

    /// <summary>Required key length in bytes.</summary>
    public const int KeySize = 32;

    /// <summary>Nonce length in bytes.</summary>
    public const int NonceSize = 12;

    /// <summary>Authentication tag length in bytes.</summary>
    public const int TagSize = 16;

    /// <summary>Bytes added to the plaintext length by the envelope.</summary>
    public const int Overhead = HeaderSize + NonceSize + TagSize;

    private const int HeaderSize = 2;

    /// <summary>
    /// Encrypts and authenticates <paramref name="plaintext"/>.
    /// </summary>
    /// <param name="key">A 256-bit key.</param>
    /// <param name="keyVersion">Generation of <paramref name="key"/>, stored in the header.</param>
    /// <param name="plaintext">Data to protect.</param>
    /// <param name="associatedData">Context the payload is bound to; must be supplied again to decrypt.</param>
    /// <returns>The envelope bytes.</returns>
    public static byte[] Seal(ReadOnlySpan<byte> key, byte keyVersion, ReadOnlySpan<byte> plaintext, ReadOnlySpan<byte> associatedData)
    {
        var envelope = new byte[Overhead + plaintext.Length];
        envelope[0] = FormatVersion;
        envelope[1] = keyVersion;

        var nonce = envelope.AsSpan(HeaderSize, NonceSize);
        var tag = envelope.AsSpan(HeaderSize + NonceSize, TagSize);
        var ciphertext = envelope.AsSpan(Overhead);
        RandomNumberGenerator.Fill(nonce);

        using var aes = new AesGcm(key, TagSize);
        aes.Encrypt(nonce, plaintext, ciphertext, tag, CombineAssociatedData(envelope.AsSpan(0, HeaderSize), associatedData));
        return envelope;
    }

    /// <summary>
    /// Verifies and decrypts an envelope produced by <see cref="Seal"/>.
    /// </summary>
    /// <param name="key">The key used to seal.</param>
    /// <param name="envelope">The envelope bytes.</param>
    /// <param name="associatedData">The same associated data passed to <see cref="Seal"/>.</param>
    /// <returns>The plaintext.</returns>
    /// <exception cref="CryptographicException">
    /// The envelope is malformed, was modified, belongs to a different context, or the key is wrong.
    /// </exception>
    public static byte[] Open(ReadOnlySpan<byte> key, ReadOnlySpan<byte> envelope, ReadOnlySpan<byte> associatedData)
    {
        if (envelope.Length < Overhead)
        {
            throw new CryptographicException("The encrypted payload is truncated.");
        }

        if (envelope[0] != FormatVersion)
        {
            throw new CryptographicException($"Unsupported encrypted payload format version {envelope[0]}.");
        }

        var nonce = envelope.Slice(HeaderSize, NonceSize);
        var tag = envelope.Slice(HeaderSize + NonceSize, TagSize);
        var ciphertext = envelope[Overhead..];
        var plaintext = new byte[ciphertext.Length];

        using var aes = new AesGcm(key, TagSize);
        aes.Decrypt(nonce, ciphertext, tag, plaintext, CombineAssociatedData(envelope[..HeaderSize], associatedData));
        return plaintext;
    }

    /// <summary>Reads the key version recorded in an envelope header without decrypting it.</summary>
    /// <param name="envelope">The envelope bytes.</param>
    /// <returns>The key version.</returns>
    /// <exception cref="CryptographicException">The envelope is too short to have a header.</exception>
    public static byte ReadKeyVersion(ReadOnlySpan<byte> envelope) =>
        envelope.Length >= HeaderSize ? envelope[1] : throw new CryptographicException("The encrypted payload is truncated.");

    private static byte[] CombineAssociatedData(ReadOnlySpan<byte> header, ReadOnlySpan<byte> associatedData)
    {
        var combined = new byte[header.Length + associatedData.Length];
        header.CopyTo(combined);
        associatedData.CopyTo(combined.AsSpan(header.Length));
        return combined;
    }
}
