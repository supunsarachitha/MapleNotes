using System.Security.Cryptography;
using MapleNotes.Server.Infrastructure.Crypto;
using MapleNotes.Server.Tests.TestSupport;

namespace MapleNotes.Server.Tests.Crypto;

public sealed class AttachmentCipherTests
{
    private const int Chunk = AttachmentCipher.ChunkSize;
    private const int Stride = AttachmentCipher.ChunkSize + AttachmentCipher.TagSize;

    private readonly byte[] _dataKey = RandomNumberGenerator.GetBytes(32);
    private readonly Guid _userId = Guid.CreateVersion7();
    private readonly Guid _attachmentId = Guid.CreateVersion7();

    public static TheoryData<int> Sizes => [0, 1, 1000, Chunk - 1, Chunk, Chunk + 1, 3 * Chunk, (3 * Chunk) + 12_345];

    [Theory]
    [MemberData(nameof(Sizes))]
    public async Task Round_trips_every_size_boundary(int size)
    {
        var plaintext = RandomNumberGenerator.GetBytes(size);

        var encrypted = await EncryptAsync(plaintext);

        var chunks = Math.Max(1, (size + Chunk - 1) / Chunk);
        Assert.Equal(AttachmentCipher.HeaderSize + (chunks * AttachmentCipher.TagSize) + size, encrypted.Length);
        Assert.Equal(plaintext, await DecryptAsync(encrypted));
    }

    [Fact]
    public async Task Reports_plaintext_length()
    {
        var encrypted = await EncryptAsync(RandomNumberGenerator.GetBytes((2 * Chunk) + 77));

        await using var stream = Open(encrypted);

        Assert.Equal((2 * Chunk) + 77, stream.Length);
    }

    [Fact]
    public async Task Output_does_not_reveal_plaintext_patterns()
    {
        var plaintext = new byte[4 * Chunk];
        Array.Fill(plaintext, (byte)'A');

        var encrypted = await EncryptAsync(plaintext);

        Assert.Equal(-1, encrypted.AsSpan().IndexOf(plaintext.AsSpan(0, 64)));
    }

    [Fact]
    public async Task Random_access_reads_match_the_plaintext()
    {
        var plaintext = RandomNumberGenerator.GetBytes((5 * Chunk) + 999);
        var encrypted = await EncryptAsync(plaintext);
        var random = new Random(42);

        await using var stream = Open(encrypted);
        for (var i = 0; i < 200; i++)
        {
            var offset = random.Next(plaintext.Length);
            var count = random.Next(1, Math.Min(3 * Chunk, plaintext.Length - offset) + 1);
            var buffer = new byte[count];

            stream.Seek(offset, SeekOrigin.Begin);
            if (i % 2 == 0)
            {
                await stream.ReadExactlyAsync(buffer, TestContext.Current.CancellationToken);
            }
            else
            {
                stream.ReadExactly(buffer);
            }

            Assert.Equal(plaintext.AsSpan(offset, count).ToArray(), buffer);
        }
    }

    [Fact]
    public async Task Reading_past_the_end_returns_zero()
    {
        var encrypted = await EncryptAsync(RandomNumberGenerator.GetBytes(10));
        await using var stream = Open(encrypted);

        stream.Seek(0, SeekOrigin.End);

        Assert.Equal(0, stream.Read(new byte[10]));
    }

    [Fact]
    public async Task Modified_ciphertext_is_detected()
    {
        var encrypted = await EncryptAsync(RandomNumberGenerator.GetBytes(3 * Chunk));
        encrypted[AttachmentCipher.HeaderSize + Stride + 100] ^= 0x01; // inside chunk 1

        await Assert.ThrowsAnyAsync<CryptographicException>(() => DecryptAsync(encrypted));
    }

    [Fact]
    public async Task Untouched_chunks_stay_readable_when_another_chunk_is_damaged()
    {
        var plaintext = RandomNumberGenerator.GetBytes(3 * Chunk);
        var encrypted = await EncryptAsync(plaintext);
        encrypted[AttachmentCipher.HeaderSize + (2 * Stride) + 5] ^= 0x01; // inside chunk 2

        await using var stream = Open(encrypted);
        var firstChunk = new byte[Chunk];
        stream.ReadExactly(firstChunk);

        Assert.Equal(plaintext.AsSpan(0, Chunk).ToArray(), firstChunk);
    }

    [Theory]
    [InlineData(0)]  // magic
    [InlineData(4)]  // format version
    [InlineData(20)] // salt
    public async Task Modified_header_is_detected(int position)
    {
        var encrypted = await EncryptAsync(RandomNumberGenerator.GetBytes(1000));
        encrypted[position] ^= 0x01;

        await Assert.ThrowsAnyAsync<CryptographicException>(() => DecryptAsync(encrypted));
    }

    [Fact]
    public async Task Truncation_at_a_chunk_boundary_is_detected()
    {
        var encrypted = await EncryptAsync(RandomNumberGenerator.GetBytes((3 * Chunk) + 10));

        var withoutLastChunk = encrypted.AsSpan(0, AttachmentCipher.HeaderSize + (3 * Stride)).ToArray();

        await Assert.ThrowsAnyAsync<CryptographicException>(() => DecryptAsync(withoutLastChunk));
    }

    [Theory]
    [InlineData(1)]
    [InlineData(17)]
    [InlineData(5000)]
    public async Task Truncation_inside_a_chunk_is_detected(int bytesRemoved)
    {
        var encrypted = await EncryptAsync(RandomNumberGenerator.GetBytes((2 * Chunk) + 10_000));

        var truncated = encrypted.AsSpan(0, encrypted.Length - bytesRemoved).ToArray();

        await Assert.ThrowsAnyAsync<CryptographicException>(() => DecryptAsync(truncated));
    }

    [Fact]
    public async Task Appended_data_is_detected()
    {
        var encrypted = await EncryptAsync(RandomNumberGenerator.GetBytes(Chunk + 10));

        byte[] extended = [.. encrypted, .. RandomNumberGenerator.GetBytes(100)];

        await Assert.ThrowsAnyAsync<CryptographicException>(() => DecryptAsync(extended));
    }

    [Fact]
    public async Task Reordered_chunks_are_detected()
    {
        var encrypted = await EncryptAsync(RandomNumberGenerator.GetBytes(3 * Chunk));
        var chunk0 = encrypted.AsSpan(AttachmentCipher.HeaderSize, Stride).ToArray();
        var chunk1 = encrypted.AsSpan(AttachmentCipher.HeaderSize + Stride, Stride).ToArray();

        chunk1.CopyTo(encrypted, AttachmentCipher.HeaderSize);
        chunk0.CopyTo(encrypted, AttachmentCipher.HeaderSize + Stride);

        await Assert.ThrowsAnyAsync<CryptographicException>(() => DecryptAsync(encrypted));
    }

    [Fact]
    public async Task Emptied_file_is_detected()
    {
        var encrypted = await EncryptAsync(RandomNumberGenerator.GetBytes(100));

        await Assert.ThrowsAnyAsync<CryptographicException>(() => DecryptAsync(encrypted.AsSpan(0, AttachmentCipher.HeaderSize).ToArray()));
    }

    [Fact]
    public async Task Wrong_key_or_identity_is_rejected()
    {
        var encrypted = await EncryptAsync(RandomNumberGenerator.GetBytes(1000));

        await Assert.ThrowsAnyAsync<CryptographicException>(() => DecryptAsync(encrypted, key: RandomNumberGenerator.GetBytes(32)));
        await Assert.ThrowsAnyAsync<CryptographicException>(() => DecryptAsync(encrypted, attachmentId: Guid.CreateVersion7()));
        await Assert.ThrowsAnyAsync<CryptographicException>(() => DecryptAsync(encrypted, userId: Guid.CreateVersion7()));
    }

    [Fact]
    public async Task Key_version_mismatch_is_rejected()
    {
        var encrypted = await EncryptAsync(RandomNumberGenerator.GetBytes(10));

        using var otherVersion = TestKeys.DataKey(_dataKey, version: 2);
        Assert.ThrowsAny<CryptographicException>(() =>
            DecryptingAttachmentStream.Open(new MemoryStream(encrypted), otherVersion, _userId, _attachmentId));
    }

    [Fact]
    public async Task Files_of_the_same_content_encrypt_differently()
    {
        var plaintext = RandomNumberGenerator.GetBytes(1000);

        Assert.NotEqual(await EncryptAsync(plaintext), await EncryptAsync(plaintext));
    }

    [Fact]
    public async Task Encrypted_files_carry_the_format_marker()
    {
        var encrypted = await EncryptAsync(RandomNumberGenerator.GetBytes(10));

        Assert.True(AttachmentCipher.HasEncryptedHeader(encrypted));
        Assert.False(AttachmentCipher.HasEncryptedHeader("\x89PNG"u8));
    }

    private async Task<byte[]> EncryptAsync(byte[] plaintext)
    {
        using var key = TestKeys.DataKey(_dataKey);
        using var output = new MemoryStream();

        var written = await AttachmentCipher.EncryptAsync(new MemoryStream(plaintext), output, key, _userId, _attachmentId);

        Assert.Equal(plaintext.Length, written);
        return output.ToArray();
    }

    private async Task<byte[]> DecryptAsync(byte[] encrypted, byte[]? key = null, Guid? userId = null, Guid? attachmentId = null)
    {
        using var dataKey = TestKeys.DataKey(key ?? _dataKey);
        await using var stream = DecryptingAttachmentStream.Open(
            new MemoryStream(encrypted), dataKey, userId ?? _userId, attachmentId ?? _attachmentId);
        using var output = new MemoryStream();
        await stream.CopyToAsync(output);
        return output.ToArray();
    }

    private DecryptingAttachmentStream Open(byte[] encrypted)
    {
        using var key = TestKeys.DataKey(_dataKey);
        return DecryptingAttachmentStream.Open(new MemoryStream(encrypted), key, _userId, _attachmentId);
    }
}
