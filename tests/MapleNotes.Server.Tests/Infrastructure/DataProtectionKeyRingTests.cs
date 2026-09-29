using System.Security.Cryptography;
using MapleNotes.Server.Infrastructure;
using MapleNotes.Server.Infrastructure.Configuration;
using MapleNotes.Server.Infrastructure.Crypto;
using MapleNotes.Server.Tests.TestSupport;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.Extensions.DependencyInjection;

namespace MapleNotes.Server.Tests.Infrastructure;

public sealed class DataProtectionKeyRingTests : IDisposable
{
    private readonly TempDirectory _dir = new();
    private readonly byte[] _masterKey = TestKeys.NewMasterKey();

    [Fact]
    public void Key_ring_on_disk_is_encrypted()
    {
        using (var services = BuildServices(_masterKey))
        {
            services.GetDataProtector("test").Protect("payload");
        }

        var keyFile = Assert.Single(Directory.GetFiles(Path.Combine(_dir.Path, "keys"), "key-*.xml"));
        var xml = File.ReadAllText(keyFile);
        Assert.Contains("MasterKeyXmlDecryptor", xml, StringComparison.Ordinal);
        Assert.DoesNotContain("<masterKey", xml, StringComparison.Ordinal);
    }

    [Fact]
    public void Tokens_survive_a_restart_with_the_same_master_key()
    {
        string token;
        using (var services = BuildServices(_masterKey))
        {
            token = services.GetDataProtector("test").Protect("payload");
        }

        using var restarted = BuildServices(_masterKey);
        Assert.Equal("payload", restarted.GetDataProtector("test").Unprotect(token));
    }

    [Fact]
    public void Key_ring_is_useless_without_the_master_key()
    {
        string token;
        using (var services = BuildServices(_masterKey))
        {
            token = services.GetDataProtector("test").Protect("payload");
        }

        using var attacker = BuildServices(TestKeys.NewMasterKey());
        Assert.ThrowsAny<CryptographicException>(() => attacker.GetDataProtector("test").Unprotect(token));
    }

    public void Dispose() => _dir.Dispose();

    private ServiceProvider BuildServices(byte[] masterKey)
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton(new MapleOptions { DataDirectory = _dir.Path });
        services.AddSingleton(new KeyMaterial(masterKey));
        services.AddMapleDataProtection();
        return services.BuildServiceProvider();
    }
}
