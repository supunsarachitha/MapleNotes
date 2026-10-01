using System.Security.Cryptography;
using System.Text.Json;
using MapleNotes.Server.Tests.TestSupport;

namespace MapleNotes.Server.Tests.E2ee;

/// <summary>
/// Shared test vectors for docs/e2ee-spec.md. This C# implementation and the web app's TypeScript implementation must
/// both reproduce src/maple-web/src/crypto/test-vectors.json exactly. Run with MAPLE_WRITE_VECTORS=1 to regenerate
/// the file after an intentional format change.
/// </summary>
public sealed class E2eeVectorTests
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { WriteIndented = true };

    [Fact]
    public void Implementation_reproduces_the_shared_test_vectors()
    {
        var computed = JsonSerializer.Serialize(Compute(), Json) + "\n";
        var path = VectorPath();
        if (Environment.GetEnvironmentVariable("MAPLE_WRITE_VECTORS") == "1")
        {
            File.WriteAllText(path, computed);
            return;
        }

        Assert.Equal(File.ReadAllText(path).ReplaceLineEndings("\n"), computed);
    }

    [Fact]
    public void Everything_in_the_vectors_decrypts_back()
    {
        var v = Compute();
        var dataKey = Convert.FromBase64String(v.DataKeyB64);
        var userId = Guid.Parse(v.Ids.UserId);

        Assert.Equal(dataKey, E2eeCrypto.Open(Convert.FromBase64String(v.Kdf.WrapKeyB64),
            Convert.FromBase64String(v.WrappedDataKey.EnvelopeB64), E2eeCrypto.DataKeyContext(userId)));
        Assert.Equal(dataKey, E2eeCrypto.Open(Convert.FromBase64String(v.Recovery.WrapKeyB64),
            Convert.FromBase64String(v.Recovery.WrappedDataKeyB64), E2eeCrypto.RecoveryContext(userId)));
        Assert.Equal(v.Note.Plaintext, E2eeCrypto.DecryptNote(dataKey, userId, Guid.Parse(v.Ids.NoteId),
            Convert.FromBase64String(v.Note.EnvelopeB64)));
        Assert.Equal(Pattern(v.Attachment.PlaintextLength),
            E2eeCrypto.DecryptAttachment(dataKey, userId, Guid.Parse(v.Ids.AttachmentId),
                E2eeCrypto.EncryptAttachment(dataKey, userId, Guid.Parse(v.Ids.AttachmentId), Pattern(v.Attachment.PlaintextLength))));
    }

    [Fact]
    public void A_ciphertext_moved_to_another_note_or_user_does_not_decrypt()
    {
        var v = Compute();
        var dataKey = Convert.FromBase64String(v.DataKeyB64);
        var envelope = Convert.FromBase64String(v.Note.EnvelopeB64);

        Assert.ThrowsAny<CryptographicException>(() =>
            E2eeCrypto.DecryptNote(dataKey, Guid.Parse(v.Ids.UserId), Guid.CreateVersion7(), envelope));
        Assert.ThrowsAny<CryptographicException>(() =>
            E2eeCrypto.DecryptNote(dataKey, Guid.CreateVersion7(), Guid.Parse(v.Ids.NoteId), envelope));
    }

    private static Vectors Compute()
    {
        var password = "correct horse battery staple Café 🍁"; // decomposed é: NFC normalization is part of the spec
        var salt = Sequence(16, start: 0x00);
        var master = E2eeCrypto.MasterSecret(password, salt, E2eeCrypto.TestMemoryKiB, E2eeCrypto.TestIterations, 1);
        var (authKey, wrapKey) = (E2eeCrypto.Hkdf(master, "maple-notes/v2/auth"), E2eeCrypto.Hkdf(master, "maple-notes/v2/wrap"));

        var userId = Guid.Parse("0192f3a1-7c2e-7d4b-9a1c-3e5f7a9b1c2d");
        var noteId = Guid.Parse("0192f3a2-0000-7abc-8def-0123456789ab");
        var attachmentId = Guid.Parse("0192f3a3-1111-7222-8333-444455556666");
        var labelId = Guid.Parse("0192f3a4-2222-7333-8444-555566667777");
        var dataKey = Enumerable.Range(0, 32).Select(i => (byte)((i * 7) + 3)).ToArray();
        var (noteKey, metadataKey, tagIndexKey) = E2eeCrypto.SubKeys(dataKey);

        var wrapNonce = Sequence(12, start: 0xA0);
        var noteNonce = Sequence(12, start: 0xB0);
        var tagNonce = Sequence(12, start: 0xC0);
        var recoveryNonce = Sequence(12, start: 0xE0);
        var metadataNonce = Sequence(12, start: 0xF0);
        var labelNonce = Sequence(12, start: 0x90);

        const string noteText = "Buy **maple** syrup #groceries 🍁\n\n- [ ] pancakes";
        const string tagName = "#Work/Meetings-";
        var token = E2eeCrypto.TagToken(dataKey, tagName);

        var recoveryKey = Sequence(32, start: 0xD0);
        var (recoveryWrap, recoveryAuth) = E2eeCrypto.RecoveryKeys(recoveryKey);

        var attachmentSalt = Sequence(32, start: 0x10);
        var plaintext = Pattern(70_000); // two chunks: 65,536 + 4,464 bytes
        var encrypted = E2eeCrypto.EncryptAttachment(dataKey, userId, attachmentId, plaintext, attachmentSalt);
        const string metadataJson = "{\"name\":\"sunset.png\",\"type\":\"image/png\",\"size\":70000}";
        const string labelName = "Café plans 🍁"; // as written: label names keep their case

        return new Vectors(
            Version: 2,
            Kdf: new KdfVector(password, B64(salt), E2eeCrypto.TestMemoryKiB, E2eeCrypto.TestIterations, 1, B64(master), B64(authKey), B64(wrapKey)),
            Ids: new IdsVector(userId.ToString(), noteId.ToString(), attachmentId.ToString(), labelId.ToString()),
            DataKeyB64: B64(dataKey),
            Subkeys: new SubkeysVector(B64(noteKey), B64(metadataKey), B64(tagIndexKey)),
            WrappedDataKey: new EnvelopeVector(B64(wrapNonce), B64(E2eeCrypto.Seal(wrapKey, dataKey, E2eeCrypto.DataKeyContext(userId), wrapNonce))),
            Note: new NoteVector(noteText, B64(noteNonce), B64(E2eeCrypto.EncryptNote(dataKey, userId, noteId, noteText, noteNonce))),
            Tag: new TagVector(tagName, E2eeCrypto.NormalizeTag(tagName), token, B64(tagNonce),
                B64(E2eeCrypto.EncryptTagName(dataKey, userId, token, tagName, tagNonce))),
            Recovery: new RecoveryVector(B64(recoveryKey), E2eeCrypto.FormatRecoveryKey(recoveryKey), B64(recoveryWrap), B64(recoveryAuth),
                B64(recoveryNonce), B64(E2eeCrypto.Seal(recoveryWrap, dataKey, E2eeCrypto.RecoveryContext(userId), recoveryNonce))),
            Attachment: new AttachmentVector(plaintext.Length, "byte i = i mod 251", B64(attachmentSalt), encrypted.Length,
                Convert.ToHexStringLower(SHA256.HashData(encrypted))),
            Metadata: new MetadataVector(metadataJson, B64(metadataNonce),
                B64(E2eeCrypto.SealMetadata(dataKey, userId, attachmentId, metadataJson, metadataNonce))),
            Label: new LabelVector(labelName, B64(labelNonce),
                B64(E2eeCrypto.Seal(metadataKey, System.Text.Encoding.UTF8.GetBytes(labelName), E2eeCrypto.LabelContext(userId, labelId), labelNonce))));
    }

    private static byte[] Sequence(int length, int start) => Enumerable.Range(0, length).Select(i => (byte)(start + i)).ToArray();

    private static byte[] Pattern(int length) => Enumerable.Range(0, length).Select(i => (byte)(i % 251)).ToArray();

    private static string B64(byte[] bytes) => Convert.ToBase64String(bytes);

    private static string VectorPath()
    {
        var root = new DirectoryInfo(AppContext.BaseDirectory);
        while (root is not null && !File.Exists(Path.Combine(root.FullName, "MapleNotes.slnx")))
        {
            root = root.Parent;
        }

        return Path.Combine(root!.FullName, "src", "maple-web", "src", "crypto", "test-vectors.json");
    }

    private sealed record Vectors(
        int Version, KdfVector Kdf, IdsVector Ids, string DataKeyB64, SubkeysVector Subkeys, EnvelopeVector WrappedDataKey,
        NoteVector Note, TagVector Tag, RecoveryVector Recovery, AttachmentVector Attachment, MetadataVector Metadata, LabelVector Label);

    private sealed record KdfVector(
        string Password, string SaltB64, int MemoryKiB, int Iterations, int Parallelism, string MasterB64, string AuthKeyB64, string WrapKeyB64);

    private sealed record IdsVector(string UserId, string NoteId, string AttachmentId, string LabelId);

    private sealed record SubkeysVector(string NoteKeyB64, string MetadataKeyB64, string TagIndexKeyB64);

    private sealed record EnvelopeVector(string NonceB64, string EnvelopeB64);

    private sealed record NoteVector(string Plaintext, string NonceB64, string EnvelopeB64);

    private sealed record TagVector(string Name, string Normalized, string Token, string NonceB64, string EncryptedNameB64);

    private sealed record RecoveryVector(
        string KeyB64, string Displayed, string WrapKeyB64, string AuthKeyB64, string NonceB64, string WrappedDataKeyB64);

    private sealed record AttachmentVector(int PlaintextLength, string PlaintextPattern, string SaltB64, int EncryptedLength, string EncryptedSha256Hex);

    private sealed record MetadataVector(string Json, string NonceB64, string EnvelopeB64);

    private sealed record LabelVector(string Name, string NonceB64, string EncryptedNameB64);
}
