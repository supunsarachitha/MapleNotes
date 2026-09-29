using System.Security.Cryptography;
using System.Text;
using MapleNotes.Server.Infrastructure.Crypto;
using MapleNotes.Server.Tests.TestSupport;

namespace MapleNotes.Server.Tests.Crypto;

public sealed class AeadEnvelopeTests
{
    private static readonly byte[] Context = "test-context"u8.ToArray();
    private readonly byte[] _key = RandomNumberGenerator.GetBytes(32);

    [Theory]
    [InlineData(0)]
    [InlineData(1)]
    [InlineData(1000)]
    [InlineData(1_000_000)]
    public void Round_trips(int length)
    {
        var plaintext = RandomNumberGenerator.GetBytes(length);

        var envelope = AeadEnvelope.Seal(_key, keyVersion: 3, plaintext, Context);

        Assert.Equal(length + AeadEnvelope.Overhead, envelope.Length);
        Assert.Equal(3, AeadEnvelope.ReadKeyVersion(envelope));
        Assert.Equal(plaintext, AeadEnvelope.Open(_key, envelope, Context));
    }

    [Fact]
    public void Same_plaintext_encrypts_differently_each_time()
    {
        var plaintext = "identical"u8.ToArray();

        Assert.NotEqual(AeadEnvelope.Seal(_key, 1, plaintext, Context), AeadEnvelope.Seal(_key, 1, plaintext, Context));
    }

    [Fact]
    public void Every_modified_byte_is_detected()
    {
        var envelope = AeadEnvelope.Seal(_key, 1, "a short secret"u8, Context);

        for (var i = 0; i < envelope.Length; i++)
        {
            var tampered = envelope.ToArray();
            tampered[i] ^= 0x01;
            Assert.ThrowsAny<CryptographicException>(() => AeadEnvelope.Open(_key, tampered, Context));
        }
    }

    [Fact]
    public void Wrong_key_is_rejected()
    {
        var envelope = AeadEnvelope.Seal(_key, 1, "secret"u8, Context);

        Assert.ThrowsAny<CryptographicException>(() => AeadEnvelope.Open(RandomNumberGenerator.GetBytes(32), envelope, Context));
    }

    [Fact]
    public void Different_context_is_rejected()
    {
        var envelope = AeadEnvelope.Seal(_key, 1, "secret"u8, Context);

        Assert.ThrowsAny<CryptographicException>(() => AeadEnvelope.Open(_key, envelope, "other-context"u8));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(10)]
    [InlineData(AeadEnvelope.Overhead - 1)]
    public void Truncated_envelopes_are_rejected(int length)
    {
        var envelope = AeadEnvelope.Seal(_key, 1, "secret"u8, Context);

        Assert.ThrowsAny<CryptographicException>(() => AeadEnvelope.Open(_key, envelope.AsSpan(0, length), Context));
    }
}

public sealed class NoteCipherTests
{
    private readonly byte[] _dataKey = RandomNumberGenerator.GetBytes(32);
    private readonly Guid _userId = Guid.CreateVersion7();
    private readonly Guid _noteId = Guid.CreateVersion7();

    [Theory]
    [InlineData("")]
    [InlineData("Plain text")]
    [InlineData("# Title\n\n- [ ] task #todo\n\nEmoji 🍁 and 日本語 and العربية")]
    public void Round_trips_unicode_markdown(string content)
    {
        using var key = TestKeys.DataKey(_dataKey);

        var envelope = NoteCipher.Encrypt(key, _userId, _noteId, content);

        Assert.Equal(content, NoteCipher.Decrypt(key, _userId, _noteId, envelope));
    }

    [Fact]
    public void Ciphertext_does_not_contain_the_text()
    {
        using var key = TestKeys.DataKey(_dataKey);

        var envelope = NoteCipher.Encrypt(key, _userId, _noteId, "my bank pin is 1234");

        Assert.DoesNotContain("bank pin", Encoding.UTF8.GetString(envelope), StringComparison.Ordinal);
    }

    [Fact]
    public void Body_copied_onto_another_note_does_not_decrypt()
    {
        using var key = TestKeys.DataKey(_dataKey);
        var envelope = NoteCipher.Encrypt(key, _userId, _noteId, "secret");

        Assert.ThrowsAny<CryptographicException>(() => NoteCipher.Decrypt(key, _userId, Guid.CreateVersion7(), envelope));
        Assert.ThrowsAny<CryptographicException>(() => NoteCipher.Decrypt(key, Guid.CreateVersion7(), _noteId, envelope));
    }
}
