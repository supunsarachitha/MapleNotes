namespace MapleNotes.Server.Features.Notes;

/// <summary>
/// Deletes notes for good once they have been in the trash for <see cref="NoteService.TrashRetention"/>: at startup and
/// then every hour.
/// </summary>
/// <param name="scopes">Creates a service scope per pass.</param>
/// <param name="logger">Logger.</param>
internal sealed class TrashCleanupService(IServiceScopeFactory scopes, ILogger<TrashCleanupService> logger) : BackgroundService
{
    /// <inheritdoc />
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromHours(1));
        do
        {
            try
            {
                await using var scope = scopes.CreateAsyncScope();
                var deleted = await scope.ServiceProvider.GetRequiredService<NoteService>().PurgeExpiredTrashAsync(stoppingToken);
                if (deleted.Notes > 0)
                {
                    logger.LogInformation(
                        "Trash cleanup deleted {Notes} note(s) and {Files} file(s) that were in the trash for over {Days} days.",
                        deleted.Notes, deleted.Files, NoteService.TrashRetention.TotalDays);
                }
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogError(ex, "Trash cleanup failed; it will be retried in an hour.");
            }
        }
        while (await timer.WaitForNextTickAsync(stoppingToken));
    }
}
