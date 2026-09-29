using System.Threading.Channels;

namespace MapleNotes.Server.Features.Encryption;

/// <summary>Wakes the encryption migration worker as soon as a user changes their setting.</summary>
public sealed class EncryptionMigrationSignal
{
    private readonly Channel<bool> _channel =
        Channel.CreateBounded<bool>(new BoundedChannelOptions(1) { FullMode = BoundedChannelFullMode.DropWrite });

    /// <summary>Requests a migration pass (repeated requests before the pass starts are merged).</summary>
    public void Notify() => _channel.Writer.TryWrite(true);

    /// <summary>Waits for a request or until <paramref name="timeout"/> elapses.</summary>
    /// <param name="timeout">Maximum wait.</param>
    /// <param name="cancellationToken">Stops waiting when the application shuts down.</param>
    /// <returns>A task that completes on a request, on timeout, or on shutdown.</returns>
    internal async Task WaitAsync(TimeSpan timeout, CancellationToken cancellationToken)
    {
        using var timeoutSource = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeoutSource.CancelAfter(timeout);
        try
        {
            await _channel.Reader.ReadAsync(timeoutSource.Token);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            // Timed out: run a periodic pass anyway (picks up work interrupted by a restart).
        }
    }
}

/// <summary>
/// Background worker that brings every user's stored content in line with their encryption-at-rest setting.
/// It runs at startup (resuming anything a restart interrupted), whenever a user toggles the setting, and every five
/// minutes.
/// </summary>
/// <param name="scopes">Creates a service scope per pass.</param>
/// <param name="signal">Wake-up requests from the settings endpoint.</param>
/// <param name="logger">Logger.</param>
internal sealed class EncryptionMigrationService(
    IServiceScopeFactory scopes, EncryptionMigrationSignal signal, ILogger<EncryptionMigrationService> logger) : BackgroundService
{
    private static readonly TimeSpan IdleInterval = TimeSpan.FromMinutes(5);
    private static readonly TimeSpan RetryInterval = TimeSpan.FromSeconds(5);

    /// <inheritdoc />
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await Task.Yield(); // never delay application startup

        while (!stoppingToken.IsCancellationRequested)
        {
            var interrupted = false;
            try
            {
                await using var scope = scopes.CreateAsyncScope();
                var migrator = scope.ServiceProvider.GetRequiredService<EncryptionMigrator>();
                foreach (var userId in await migrator.FindPendingUsersAsync(stoppingToken))
                {
                    var result = await migrator.MigrateUserAsync(userId, stoppingToken);
                    interrupted |= !result.Completed;
                    if (result.ProcessedItems > 0)
                    {
                        logger.LogInformation(
                            "Converted {Count} note(s) and attachment(s) of user {UserId} to match their encryption setting.",
                            result.ProcessedItems, userId);
                    }
                }
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogError(ex, "Encryption migration pass failed; it will be retried.");
                interrupted = true;
            }

            await signal.WaitAsync(interrupted ? RetryInterval : IdleInterval, stoppingToken);
        }
    }
}
