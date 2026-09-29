using System.Buffers;
using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text;

namespace MapleNotes.Server.Infrastructure.Crypto;

/// <summary>
/// Streaming authenticated encryption for attachment files: chunked AES-256-GCM following the STREAM construction
/// (Hoang, Reyhanitabar, Rogaway and Vizár, 2015), the same approach used by Google Tink and <c>age</c>.
/// </summary>
/// <remarks>
/// <para>File layout:</para>
/// <code>
/// header, 42 bytes
///   [0..3]   magic "MNAE" (Maple Notes Attachment, Encrypted)
///   [4]      format version (1)
///   [5]      data key version
///   [6..9]   plaintext chunk size, big-endian uint32 (65,536)
///   [10..41] random salt
/// chunks 0 … n-1
///   ciphertext of up to one chunk of plaintext, then a 16-byte authentication tag.
///   Every chunk except the last holds exactly one full chunk; the last may be shorter, even empty.
/// </code>
/// <para>
/// Each file is encrypted with its own key, HKDF-SHA256(user data key, salt, "maple-notes/v1/attachment"), so nonces
/// can never repeat across files. The nonce of chunk <c>i</c> is 7 zero bytes, <c>i</c> as a big-endian uint32, and a
/// final-chunk flag (1 for the last chunk, otherwise 0). Every chunk also authenticates the header and the owner's
/// and attachment's IDs. The result:
/// </para>
/// <list type="bullet">
/// <item>constant memory use: files are processed one 64 KiB chunk at a time;</item>
/// <item>any modified byte is detected; reordered chunks fail (counter in the nonce); truncated files and appended
/// data fail (final-chunk flag and file layout);</item>
/// <item>random access: any byte range decrypts by reading only the chunks that contain it, which enables HTTP Range
/// requests (needed for video seeking on iOS Safari). See <see cref="DecryptingAttachmentStream"/>.</item>
/// </list>
/// </remarks>
internal static class AttachmentCipher
{
    /// <summary>Plaintext bytes per chunk.</summary>
    public const int ChunkSize = 64 * 1024;

    /// <summary>Authentication tag bytes appended to each chunk.</summary>
    public const int TagSize = 16;

    /// <summary>Length of the per-file salt.</summary>
    public const int SaltSize = 32;

    /// <summary>Length of the file header.</summary>
    public const int HeaderSize = 4 + 1 + 1 + 4 + SaltSize;

    /// <summary>Current file format version.</summary>
    public const byte FormatVersion = 1;

    /// <summary>Smallest and largest chunk sizes accepted when reading, to reject corrupt headers early.</summary>
    private const int MinChunkSize = 1024, MaxChunkSize = 16 * 1024 * 1024;

    private const int NonceSize = 12;
    private const int SaltOffset = 10;

    private static readonly byte[] FileKeyInfo = "maple-notes/v1/attachment"u8.ToArray();

    private static ReadOnlySpan<byte> Magic => "MNAE"u8;

    /// <summary>
    /// Encrypts <paramref name="source"/> into <paramref name="destination"/>.
    /// </summary>
    /// <param name="source">Plaintext; read to the end.</param>
    /// <param name="destination">Receives the encrypted file.</param>
    /// <param name="key">The owner's data key.</param>
    /// <param name="userId">The owner's ID, bound into every chunk.</param>
    /// <param name="attachmentId">The attachment's ID, bound into every chunk.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>Number of plaintext bytes encrypted.</returns>
    public static async Task<long> EncryptAsync(
        Stream source, Stream destination, UserDataKey key, Guid userId, Guid attachmentId,
        CancellationToken cancellationToken = default)
    {
        var header = CreateHeader(key.Version);
        var fileKey = DeriveFileKey(key.Span, header.AsSpan(SaltOffset, SaltSize));
        var associatedData = BuildAssociatedData(header, userId, attachmentId);

        var current = ArrayPool<byte>.Shared.Rent(ChunkSize);
        var next = ArrayPool<byte>.Shared.Rent(ChunkSize);
        var output = ArrayPool<byte>.Shared.Rent(ChunkSize + TagSize);
        try
        {
            using var aes = new AesGcm(fileKey, TagSize);
            await destination.WriteAsync(header, cancellationToken);

            var currentLength = await ReadFullAsync(source, current.AsMemory(0, ChunkSize), cancellationToken);
            var total = (long)currentLength;
            for (uint index = 0; ; index = checked(index + 1))
            {
                // Only a full chunk can have a successor; read ahead to learn whether this chunk is the last one.
                var nextLength = currentLength == ChunkSize
                    ? await ReadFullAsync(source, next.AsMemory(0, ChunkSize), cancellationToken)
                    : 0;
                var isFinal = nextLength == 0;

                SealChunk(aes, index, isFinal, current.AsSpan(0, currentLength), output, associatedData);
                await destination.WriteAsync(output.AsMemory(0, currentLength + TagSize), cancellationToken);

                if (isFinal)
                {
                    return total;
                }

                (current, next) = (next, current);
                currentLength = nextLength;
                total += nextLength;
            }
        }
        finally
        {
            CryptographicOperations.ZeroMemory(fileKey);
            ArrayPool<byte>.Shared.Return(current, clearArray: true);
            ArrayPool<byte>.Shared.Return(next, clearArray: true);
            ArrayPool<byte>.Shared.Return(output, clearArray: true);
        }
    }

    /// <summary>Returns true when <paramref name="start"/> begins with the encrypted-attachment magic bytes.</summary>
    /// <param name="start">The first bytes of a file.</param>
    /// <returns>Whether the file looks like an encrypted attachment.</returns>
    public static bool HasEncryptedHeader(ReadOnlySpan<byte> start) => start.StartsWith(Magic);

    /// <summary>Validates a header and extracts its fields.</summary>
    /// <param name="header">The first <see cref="HeaderSize"/> bytes of the file.</param>
    /// <returns>The key version, chunk size and salt.</returns>
    /// <exception cref="CryptographicException">The header is not a valid encrypted-attachment header.</exception>
    internal static (byte KeyVersion, int ChunkSize, byte[] Salt) ParseHeader(ReadOnlySpan<byte> header)
    {
        if (header.Length < HeaderSize || !header.StartsWith(Magic))
        {
            throw new CryptographicException("The file is not an encrypted Maple Notes attachment.");
        }

        if (header[4] != FormatVersion)
        {
            throw new CryptographicException($"Unsupported attachment encryption format version {header[4]}.");
        }

        var chunkSize = BinaryPrimitives.ReadUInt32BigEndian(header.Slice(6, 4));
        if (chunkSize is < MinChunkSize or > MaxChunkSize)
        {
            throw new CryptographicException("The attachment header declares an invalid chunk size.");
        }

        return (header[5], (int)chunkSize, header.Slice(SaltOffset, SaltSize).ToArray());
    }

    /// <summary>Derives the per-file key from the owner's data key and the file's salt.</summary>
    /// <param name="dataKey">The owner's data key.</param>
    /// <param name="salt">The salt stored in the file header.</param>
    /// <returns>A 256-bit key; the caller should wipe it after use.</returns>
    internal static byte[] DeriveFileKey(ReadOnlySpan<byte> dataKey, ReadOnlySpan<byte> salt)
    {
        var fileKey = new byte[32];
        HKDF.DeriveKey(HashAlgorithmName.SHA256, dataKey, fileKey, salt, FileKeyInfo);
        return fileKey;
    }

    /// <summary>Builds the associated data authenticated by every chunk: header, owner ID and attachment ID.</summary>
    /// <param name="header">The file header.</param>
    /// <param name="userId">The owner's ID.</param>
    /// <param name="attachmentId">The attachment's ID.</param>
    /// <returns>The associated data bytes.</returns>
    internal static byte[] BuildAssociatedData(ReadOnlySpan<byte> header, Guid userId, Guid attachmentId)
    {
        var context = Encoding.UTF8.GetBytes($"maple-notes/v1/attachment/{userId:N}/{attachmentId:N}");
        var associatedData = new byte[HeaderSize + context.Length];
        header[..HeaderSize].CopyTo(associatedData);
        context.CopyTo(associatedData.AsSpan(HeaderSize));
        return associatedData;
    }

    /// <summary>Writes the nonce for a chunk: 7 zero bytes, the big-endian chunk index and the final-chunk flag.</summary>
    /// <param name="nonce">A 12-byte destination.</param>
    /// <param name="index">The chunk index.</param>
    /// <param name="isFinal">Whether this is the last chunk of the file.</param>
    internal static void WriteNonce(Span<byte> nonce, uint index, bool isFinal)
    {
        nonce.Clear();
        BinaryPrimitives.WriteUInt32BigEndian(nonce.Slice(7, 4), index);
        nonce[11] = isFinal ? (byte)1 : (byte)0;
    }

    private static byte[] CreateHeader(byte keyVersion)
    {
        var header = new byte[HeaderSize];
        Magic.CopyTo(header);
        header[4] = FormatVersion;
        header[5] = keyVersion;
        BinaryPrimitives.WriteUInt32BigEndian(header.AsSpan(6, 4), ChunkSize);
        RandomNumberGenerator.Fill(header.AsSpan(SaltOffset, SaltSize));
        return header;
    }

    private static void SealChunk(
        AesGcm aes, uint index, bool isFinal, ReadOnlySpan<byte> plaintext, Span<byte> output, ReadOnlySpan<byte> associatedData)
    {
        Span<byte> nonce = stackalloc byte[NonceSize];
        WriteNonce(nonce, index, isFinal);
        aes.Encrypt(nonce, plaintext, output[..plaintext.Length], output.Slice(plaintext.Length, TagSize), associatedData);
    }

    private static async ValueTask<int> ReadFullAsync(Stream source, Memory<byte> buffer, CancellationToken cancellationToken)
    {
        var total = 0;
        while (total < buffer.Length)
        {
            var read = await source.ReadAsync(buffer[total..], cancellationToken);
            if (read == 0)
            {
                break;
            }

            total += read;
        }

        return total;
    }
}
