using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text;
using Konscious.Security.Cryptography;

namespace MapleNotes.Server.Tests.TestSupport;

/// <summary>
/// An independent C# implementation of docs/e2ee-spec.md. Tests use it to act exactly like the browser (key-derived
/// sign-in, client-side encryption), and it cross-checks the web app's TypeScript implementation through the shared
/// test vectors.
/// </summary>
internal static class E2eeCrypto
{
    /// <summary>The spec's minimum Argon2id parameters; used in tests to keep them fast.</summary>
    public const int TestMemoryKiB = 19456;

    /// <summary>Minimum passes.</summary>
    public const int TestIterations = 2;

    private const int ChunkSize = 64 * 1024;

    public static byte[] MasterSecret(string password, byte[] salt, int memoryKiB, int iterations, int parallelism)
    {
        using var argon = new Argon2id(Encoding.UTF8.GetBytes(password.Normalize(NormalizationForm.FormC)))
        {
            Salt = salt,
            MemorySize = memoryKiB,
            Iterations = iterations,
            DegreeOfParallelism = parallelism,
        };
        return argon.GetBytes(32);
    }

    public static byte[] Hkdf(byte[] ikm, string info, byte[]? salt = null) =>
        HKDF.DeriveKey(HashAlgorithmName.SHA256, ikm, 32, salt ?? [], Encoding.UTF8.GetBytes(info));

    public static (byte[] AuthKey, byte[] WrapKey) AccountKeys(
        string password, byte[] salt, int memoryKiB = TestMemoryKiB, int iterations = TestIterations, int parallelism = 1)
    {
        var master = MasterSecret(password, salt, memoryKiB, iterations, parallelism);
        return (Hkdf(master, "maple-notes/v2/auth"), Hkdf(master, "maple-notes/v2/wrap"));
    }

    // ------------------------------------------------------------------------------------------------ envelope

    public static byte[] Seal(byte[] key, byte[] plaintext, string context, byte[]? nonce = null, byte keyVersion = 1)
    {
        byte[] header = [1, keyVersion];
        nonce ??= RandomNumberGenerator.GetBytes(12);
        var ciphertext = new byte[plaintext.Length];
        var tag = new byte[16];
        byte[] aad = [.. header, .. Encoding.UTF8.GetBytes(context)];
        using var aes = new AesGcm(key, 16);
        aes.Encrypt(nonce, plaintext, ciphertext, tag, aad);
        return [.. header, .. nonce, .. tag, .. ciphertext];
    }

    public static byte[] Open(byte[] key, byte[] envelope, string context)
    {
        var plaintext = new byte[envelope.Length - 30];
        byte[] aad = [.. envelope.AsSpan(0, 2), .. Encoding.UTF8.GetBytes(context)];
        using var aes = new AesGcm(key, 16);
        aes.Decrypt(envelope.AsSpan(2, 12), envelope.AsSpan(30), envelope.AsSpan(14, 16), plaintext, aad);
        return plaintext;
    }

    public static string N(Guid id) => id.ToString("N");

    public static string DataKeyContext(Guid userId) => $"maple-notes/v2/e2ee/data-key/{N(userId)}";

    public static string RecoveryContext(Guid userId) => $"maple-notes/v2/e2ee/recovery/{N(userId)}";

    public static string NoteContext(Guid userId, Guid noteId) => $"maple-notes/v2/e2ee/note/{N(userId)}/{N(noteId)}";

    public static string TagContext(Guid userId, string token) => $"maple-notes/v2/e2ee/tag/{N(userId)}/{token}";

    public static string MetadataContext(Guid userId, Guid attachmentId) =>
        $"maple-notes/v2/e2ee/attachment-meta/{N(userId)}/{N(attachmentId)}";

    // ----------------------------------------------------------------------------------------------- data key

    public static (byte[] Note, byte[] Metadata, byte[] TagIndex) SubKeys(byte[] dataKey) =>
        (Hkdf(dataKey, "maple-notes/v2/e2ee/note"),
         Hkdf(dataKey, "maple-notes/v2/e2ee/metadata"),
         Hkdf(dataKey, "maple-notes/v2/e2ee/tag-index"));

    public static byte[] EncryptNote(byte[] dataKey, Guid userId, Guid noteId, string text, byte[]? nonce = null) =>
        Seal(SubKeys(dataKey).Note, Encoding.UTF8.GetBytes(text), NoteContext(userId, noteId), nonce);

    public static string DecryptNote(byte[] dataKey, Guid userId, Guid noteId, byte[] envelope) =>
        Encoding.UTF8.GetString(Open(SubKeys(dataKey).Note, envelope, NoteContext(userId, noteId)));

    // ---------------------------------------------------------------------------------------------------- tags

    public static string NormalizeTag(string name)
    {
        var normalized = name.Normalize(NormalizationForm.FormC);
        if (normalized.StartsWith('#'))
        {
            normalized = normalized[1..];
        }

        return normalized.TrimEnd('/', '-').ToLowerInvariant();
    }

    public static string TagToken(byte[] dataKey, string name) =>
        Base64Url(HMACSHA256.HashData(SubKeys(dataKey).TagIndex, Encoding.UTF8.GetBytes(NormalizeTag(name)))[..16]);

    public static byte[] EncryptTagName(byte[] dataKey, Guid userId, string token, string name, byte[]? nonce = null) =>
        Seal(SubKeys(dataKey).Metadata, Encoding.UTF8.GetBytes(NormalizeTag(name)), TagContext(userId, token), nonce);

    public static string Base64Url(byte[] bytes) =>
        Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    // ------------------------------------------------------------------------------------------------ recovery

    private const string Crockford = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

    public static string FormatRecoveryKey(byte[] key)
    {
        var text = new StringBuilder();
        int buffer = 0, bits = 0;
        foreach (var b in key)
        {
            buffer = (buffer << 8) | b;
            bits += 8;
            while (bits >= 5)
            {
                bits -= 5;
                text.Append(Crockford[(buffer >> bits) & 31]);
            }

            buffer &= (1 << bits) - 1;
        }

        if (bits > 0)
        {
            text.Append(Crockford[(buffer << (5 - bits)) & 31]);
        }

        return string.Join('-', text.ToString().Chunk(4).Select(group => new string(group)));
    }

    public static (byte[] WrapKey, byte[] AuthKey) RecoveryKeys(byte[] recoveryKey) =>
        (Hkdf(recoveryKey, "maple-notes/v2/recovery/wrap"), Hkdf(recoveryKey, "maple-notes/v2/recovery/auth"));

    // --------------------------------------------------------------------------------------------- attachments

    public static byte[] EncryptAttachment(byte[] dataKey, Guid userId, Guid attachmentId, byte[] plaintext, byte[]? salt = null)
    {
        var header = new byte[42];
        "MNAE"u8.CopyTo(header);
        header[4] = 1;
        header[5] = 1;
        BinaryPrimitives.WriteUInt32BigEndian(header.AsSpan(6, 4), ChunkSize);
        (salt ?? RandomNumberGenerator.GetBytes(32)).CopyTo(header, 10);

        using var aes = new AesGcm(Hkdf(dataKey, "maple-notes/v2/e2ee/attachment", header[10..42]), 16);
        byte[] aad = [.. header, .. Encoding.UTF8.GetBytes($"maple-notes/v2/e2ee/attachment/{N(userId)}/{N(attachmentId)}")];
        using var output = new MemoryStream();
        output.Write(header);

        var chunks = Math.Max(1, (plaintext.Length + ChunkSize - 1) / ChunkSize);
        for (var index = 0; index < chunks; index++)
        {
            var plain = plaintext.AsSpan(index * ChunkSize, Math.Min(ChunkSize, plaintext.Length - (index * ChunkSize)));
            var ciphertext = new byte[plain.Length];
            var tag = new byte[16];
            aes.Encrypt(Nonce(index, index == chunks - 1), plain, ciphertext, tag, aad);
            output.Write(ciphertext);
            output.Write(tag);
        }

        return output.ToArray();
    }

    public static byte[] DecryptAttachment(byte[] dataKey, Guid userId, Guid attachmentId, byte[] encrypted)
    {
        var header = encrypted[..42];
        using var aes = new AesGcm(Hkdf(dataKey, "maple-notes/v2/e2ee/attachment", header[10..42]), 16);
        byte[] aad = [.. header, .. Encoding.UTF8.GetBytes($"maple-notes/v2/e2ee/attachment/{N(userId)}/{N(attachmentId)}")];
        var stride = ChunkSize + 16;
        var body = encrypted.Length - 42;
        var chunks = (body + stride - 1) / stride;
        using var output = new MemoryStream();
        for (var index = 0; index < chunks; index++)
        {
            var piece = encrypted.AsSpan(42 + (index * stride), Math.Min(stride, body - (index * stride)));
            var plain = new byte[piece.Length - 16];
            aes.Decrypt(Nonce(index, index == chunks - 1), piece[..^16], piece[^16..], plain, aad);
            output.Write(plain);
        }

        return output.ToArray();
    }

    public static byte[] SealMetadata(byte[] dataKey, Guid userId, Guid attachmentId, string json, byte[]? nonce = null) =>
        Seal(SubKeys(dataKey).Metadata, Encoding.UTF8.GetBytes(json), MetadataContext(userId, attachmentId), nonce);

    private static byte[] Nonce(int index, bool isFinal)
    {
        var nonce = new byte[12];
        BinaryPrimitives.WriteUInt32BigEndian(nonce.AsSpan(7, 4), (uint)index);
        nonce[11] = isFinal ? (byte)1 : (byte)0;
        return nonce;
    }
}
