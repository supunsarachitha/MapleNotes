using MapleNotes.Server.Infrastructure.Configuration;
using MapleNotes.Server.Infrastructure.Crypto;
using MapleNotes.Server.Infrastructure.Persistence;

namespace MapleNotes.Server.Infrastructure.Hosting;

/// <summary>
/// Prepares the instance before anything else starts: validates settings and the master key, creates the data
/// directory layout and migrates the database.
/// </summary>
/// <remarks>
/// It runs in <see cref="IHostedLifecycleService.StartingAsync"/>, which the host calls before any hosted service's
/// <c>StartAsync</c> and before the web server accepts requests. Problems surface as
/// <see cref="MapleStartupException"/>, which <c>Program</c> reports as a one-line error.
/// </remarks>
/// <param name="services">Root service provider.</param>
/// <param name="logger">Logger.</param>
internal sealed class StartupInitializer(IServiceProvider services, ILogger<StartupInitializer> logger) : IHostedLifecycleService
{
    /// <inheritdoc />
    public async Task StartingAsync(CancellationToken cancellationToken)
    {
        var options = services.GetRequiredService<MapleOptions>();
        options.EnsureDirectories();

        var keys = services.GetRequiredService<KeyMaterial>();
        logger.LogInformation(
            "Data directory: {DataDirectory}. Master key fingerprint: {Fingerprint}.", options.DataDirectory, keys.Fingerprint);

        await using var scope = services.CreateAsyncScope();
        await scope.ServiceProvider.GetRequiredService<DatabaseInitializer>().InitializeAsync(cancellationToken);
    }

    /// <inheritdoc />
    public Task StartAsync(CancellationToken cancellationToken) => Task.CompletedTask;

    /// <inheritdoc />
    public Task StartedAsync(CancellationToken cancellationToken) => Task.CompletedTask;

    /// <inheritdoc />
    public Task StoppingAsync(CancellationToken cancellationToken) => Task.CompletedTask;

    /// <inheritdoc />
    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;

    /// <inheritdoc />
    public Task StoppedAsync(CancellationToken cancellationToken) => Task.CompletedTask;
}
