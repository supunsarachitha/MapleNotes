using System.Net;
using MapleNotes.Server.Infrastructure.Configuration;
using MapleNotes.Server.Tests.TestSupport;
using Microsoft.Extensions.Configuration;

namespace MapleNotes.Server.Tests.Infrastructure;

public sealed class MapleOptionsTests : IDisposable
{
    private readonly TempDirectory _dir = new();

    [Fact]
    public void Defaults_are_safe()
    {
        var options = MapleOptions.FromConfiguration(Config(), _dir.Path);

        Assert.Equal(Path.Combine(_dir.Path, "data"), options.DataDirectory);
        Assert.False(options.AllowRegistration);
        Assert.True(options.DefaultEncryption);
        Assert.Equal(25, options.MaxUploadMegabytes);
        Assert.Equal(25L * 1024 * 1024, options.MaxUploadBytes);
        Assert.Empty(options.TrustedProxies);
    }

    [Fact]
    public void Reads_all_settings()
    {
        var options = MapleOptions.FromConfiguration(Config(
            (MapleOptions.DataDirectoryKey, "store"),
            (MapleOptions.AllowRegistrationKey, "yes"),
            (MapleOptions.MaxUploadMegabytesKey, "100"),
            (MapleOptions.DefaultEncryptionKey, "false"),
            (MapleOptions.TrustedProxiesKey, "10.0.0.1, 172.18.0.0/16")), _dir.Path);

        Assert.Equal(Path.Combine(_dir.Path, "store"), options.DataDirectory);
        Assert.True(options.AllowRegistration);
        Assert.Equal(100, options.MaxUploadMegabytes);
        Assert.False(options.DefaultEncryption);
        Assert.Equal([IPNetwork.Parse("10.0.0.1/32"), IPNetwork.Parse("172.18.0.0/16")], options.TrustedProxies);
    }

    [Theory]
    [InlineData(MapleOptions.AllowRegistrationKey, "maybe")]
    [InlineData(MapleOptions.MaxUploadMegabytesKey, "0")]
    [InlineData(MapleOptions.MaxUploadMegabytesKey, "lots")]
    [InlineData(MapleOptions.TrustedProxiesKey, "my-proxy")]
    public void Invalid_values_name_the_setting(string key, string value)
    {
        var ex = Assert.Throws<MapleStartupException>(() => MapleOptions.FromConfiguration(Config((key, value)), _dir.Path));

        Assert.Contains(key, ex.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Creates_the_data_directory_layout()
    {
        var options = new MapleOptions { DataDirectory = Path.Combine(_dir.Path, "fresh") };

        options.EnsureDirectories();

        Assert.True(Directory.Exists(options.AttachmentsDirectory));
        Assert.True(Directory.Exists(options.KeysDirectory));
        Assert.True(Directory.Exists(options.BackupsDirectory));
    }

    public void Dispose() => _dir.Dispose();

    private static IConfiguration Config(params (string Key, string Value)[] values) =>
        new ConfigurationBuilder()
            .AddInMemoryCollection(values.Select(v => new KeyValuePair<string, string?>(v.Key, v.Value)))
            .Build();
}
