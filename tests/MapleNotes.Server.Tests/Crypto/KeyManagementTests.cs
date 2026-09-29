using System.Security.Cryptography;
using MapleNotes.Server.Infrastructure.Configuration;
using MapleNotes.Server.Infrastructure.Crypto;
using MapleNotes.Server.Tests.TestSupport;
using Microsoft.Extensions.Configuration;

namespace MapleNotes.Server.Tests.Crypto;

public sealed class MasterKeyTests : IDisposable
{
    private readonly TempDirectory _dir = new();

    [Fact]
    public void Loads_a_base64_key_from_configuration()
    {
        var encoded = MasterKey.Generate();

        var key = MasterKey.Load(Config((MasterKey.ValueKey, encoded)));

        Assert.Equal(Convert.FromBase64String(encoded), key);
    }

    [Fact]
    public void Loads_a_key_from_a_file_ignoring_surrounding_whitespace()
    {
        var encoded = MasterKey.Generate();
        var path = _dir.File("master.key");
        File.WriteAllText(path, $"  {encoded}\n");

        var key = MasterKey.Load(Config((MasterKey.FileKey, path)));

        Assert.Equal(Convert.FromBase64String(encoded), key);
    }

    [Fact]
    public void Missing_key_explains_how_to_generate_one()
    {
        var ex = Assert.Throws<MapleStartupException>(() => MasterKey.Load(Config()));

        Assert.Contains("MAPLE_MASTER_KEY is not set", ex.Message, StringComparison.Ordinal);
        Assert.Contains("openssl rand -base64 32", ex.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Rejects_both_inline_and_file_keys()
    {
        var ex = Assert.Throws<MapleStartupException>(() =>
            MasterKey.Load(Config((MasterKey.ValueKey, MasterKey.Generate()), (MasterKey.FileKey, "/run/secrets/key"))));

        Assert.Contains("not both", ex.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Missing_key_file_is_reported()
    {
        var ex = Assert.Throws<MapleStartupException>(() => MasterKey.Load(Config((MasterKey.FileKey, _dir.File("absent.key")))));

        Assert.Contains("Cannot read the master key file", ex.Message, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("not base64 at all!")]
    [InlineData("c2hvcnQ=")] // "short": 5 bytes
    [InlineData("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=")] // 64 bytes
    public void Rejects_malformed_keys_without_echoing_them(string value)
    {
        var ex = Assert.Throws<MapleStartupException>(() => MasterKey.Parse(value));

        Assert.DoesNotContain(value, ex.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Generated_keys_are_random_256_bit_values()
    {
        var first = Convert.FromBase64String(MasterKey.Generate());
        var second = Convert.FromBase64String(MasterKey.Generate());

        Assert.Equal(32, first.Length);
        Assert.NotEqual(first, second);
    }

    public void Dispose() => _dir.Dispose();

    private static IConfiguration Config(params (string Key, string Value)[] values) =>
        new ConfigurationBuilder()
            .AddInMemoryCollection(values.Select(v => new KeyValuePair<string, string?>(v.Key, v.Value)))
            .Build();
}

public sealed class KeyMaterialTests
{
    [Fact]
    public void Derivation_is_deterministic_for_the_same_master_key()
    {
        var master = TestKeys.NewMasterKey();

        using var first = new KeyMaterial(master);
        using var second = new KeyMaterial(master);

        Assert.True(first.DatabaseKey.SequenceEqual(second.DatabaseKey));
        Assert.True(first.KeyEncryptionKey.SequenceEqual(second.KeyEncryptionKey));
        Assert.True(first.DataProtectionKey.SequenceEqual(second.DataProtectionKey));
        Assert.Equal(first.Fingerprint, second.Fingerprint);
    }

    [Fact]
    public void Each_purpose_gets_an_independent_key()
    {
        var master = TestKeys.NewMasterKey();
        using var keys = new KeyMaterial(master);

        byte[][] derived = [keys.DatabaseKey.ToArray(), keys.KeyEncryptionKey.ToArray(), keys.DataProtectionKey.ToArray(), master];

        Assert.Equal(derived.Length, derived.Select(Convert.ToHexString).Distinct().Count());
    }

    [Fact]
    public void Different_master_keys_give_different_keys_and_fingerprints()
    {
        using var first = TestKeys.NewKeyMaterial();
        using var second = TestKeys.NewKeyMaterial();

        Assert.False(first.DatabaseKey.SequenceEqual(second.DatabaseKey));
        Assert.NotEqual(first.Fingerprint, second.Fingerprint);
    }

    [Fact]
    public void Fingerprint_is_eight_lowercase_hex_characters()
    {
        using var keys = TestKeys.NewKeyMaterial();

        Assert.Matches("^[0-9a-f]{8}$", keys.Fingerprint);
    }

    [Fact]
    public void Rejects_master_keys_that_are_not_256_bits()
    {
        Assert.Throws<ArgumentException>(() => new KeyMaterial(RandomNumberGenerator.GetBytes(16)));
    }
}

public sealed class DataKeyServiceTests
{
    private readonly KeyMaterial _keys = TestKeys.NewKeyMaterial();

    [Fact]
    public void Wrapped_key_unwraps_for_its_owner()
    {
        var service = new DataKeyService(_keys);
        var userId = Guid.CreateVersion7();

        var wrapped = service.CreateWrappedKey(userId);
        using var key = service.Unwrap(userId, wrapped);

        Assert.Equal(32, key.Span.Length);
        Assert.Equal(DataKeyService.CurrentDataKeyVersion, key.Version);
    }

    [Fact]
    public void Each_user_gets_a_different_key()
    {
        var service = new DataKeyService(_keys);
        var (alice, bob) = (Guid.CreateVersion7(), Guid.CreateVersion7());

        using var aliceKey = service.Unwrap(alice, service.CreateWrappedKey(alice));
        using var bobKey = service.Unwrap(bob, service.CreateWrappedKey(bob));

        Assert.False(aliceKey.Span.SequenceEqual(bobKey.Span));
    }

    [Fact]
    public void Wrapped_key_copied_to_another_user_does_not_unwrap()
    {
        var service = new DataKeyService(_keys);
        var wrapped = service.CreateWrappedKey(Guid.CreateVersion7());

        Assert.ThrowsAny<CryptographicException>(() => service.Unwrap(Guid.CreateVersion7(), wrapped));
    }

    [Fact]
    public void Wrapped_key_does_not_unwrap_under_a_different_master_key()
    {
        var userId = Guid.CreateVersion7();
        var wrapped = new DataKeyService(_keys).CreateWrappedKey(userId);

        using var otherKeys = TestKeys.NewKeyMaterial();
        Assert.ThrowsAny<CryptographicException>(() => new DataKeyService(otherKeys).Unwrap(userId, wrapped));
    }

    [Fact]
    public void Disposing_the_key_wipes_it()
    {
        var service = new DataKeyService(_keys);
        var userId = Guid.CreateVersion7();
        var key = service.Unwrap(userId, service.CreateWrappedKey(userId));

        key.Dispose();

        Assert.True(key.Span.ToArray().All(b => b == 0));
    }
}
