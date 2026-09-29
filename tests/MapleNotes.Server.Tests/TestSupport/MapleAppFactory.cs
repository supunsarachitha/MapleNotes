using MapleNotes.Server.Features.Encryption;
using MapleNotes.Server.Infrastructure.Configuration;
using MapleNotes.Server.Infrastructure.Crypto;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace MapleNotes.Server.Tests.TestSupport;

/// <summary>
/// Hosts the real application in memory with its own random master key and a temporary data directory.
/// </summary>
public class MapleAppFactory : WebApplicationFactory<Program>
{
    private readonly TempDirectory _dataDirectory = new();
    private bool _started;

    public string MasterKeyBase64 { get; } = MasterKey.Generate();

    public string DataDirectory => _dataDirectory.Path;

    /// <summary>Extra configuration values (MAPLE_* keys) applied on top of the defaults.</summary>
    public Dictionary<string, string?> Settings { get; } = new()
    {
        // Tests sign in many times from the same (empty) client address.
        [MapleOptions.AuthenticationRateLimitKey] = "10000",
    };

    /// <summary>Set to false to start the app without a master key.</summary>
    public bool ProvideMasterKey { get; set; } = true;

    /// <summary>
    /// Set to false to keep the background encryption worker from running, so a test can drive
    /// <c>EncryptionMigrator</c> itself (and simulate crashes) without racing it.
    /// </summary>
    public bool RunEncryptionWorker { get; set; } = true;

    /// <summary>Replaces or adds services for a test (for example a fake network for link previews).</summary>
    public Action<IServiceCollection>? ConfigureTestServices { get; set; }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        if (ProvideMasterKey)
        {
            builder.UseSetting(MasterKey.ValueKey, MasterKeyBase64);
        }

        builder.UseSetting(MapleOptions.DataDirectoryKey, DataDirectory);
        foreach (var (key, value) in Settings)
        {
            builder.UseSetting(key, value);
        }

        builder.ConfigureServices(services =>
        {
            services.AddSingleton<IHostedService>(new StartupSignal(this));
            if (!RunEncryptionWorker)
            {
                services.Remove(services.Single(s => s.ImplementationType == typeof(EncryptionMigrationService)));
            }

            ConfigureTestServices?.Invoke(services);
        });
    }

    public override async ValueTask DisposeAsync()
    {
        // WebApplicationFactory cannot stop a host that never finished starting.
        if (_started)
        {
            await base.DisposeAsync();
        }

        SqliteConnection.ClearAllPools();
        _dataDirectory.Dispose();
        GC.SuppressFinalize(this);
    }

    /// <summary>Records that the host started; runs only after every startup step succeeded.</summary>
    private sealed class StartupSignal(MapleAppFactory owner) : IHostedService
    {
        public Task StartAsync(CancellationToken cancellationToken)
        {
            owner._started = true;
            return Task.CompletedTask;
        }

        public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;
    }
}
