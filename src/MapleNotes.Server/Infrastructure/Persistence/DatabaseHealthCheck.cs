using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Diagnostics.HealthChecks;

namespace MapleNotes.Server.Infrastructure.Persistence;

/// <summary>
/// Reports whether the encrypted database can actually be read.
/// </summary>
/// <remarks>
/// Opening a SQLCipher connection succeeds even with the wrong key; the error only appears when a page is decrypted.
/// This check therefore reads the schema table instead of merely connecting.
/// </remarks>
/// <param name="db">Database context.</param>
internal sealed class DatabaseHealthCheck(MapleDbContext db) : IHealthCheck
{
    /// <inheritdoc />
    public async Task<HealthCheckResult> CheckHealthAsync(HealthCheckContext context, CancellationToken cancellationToken = default)
    {
        try
        {
            await db.Database
                .SqlQueryRaw<int>("SELECT count(*) AS \"Value\" FROM sqlite_master")
                .SingleAsync(cancellationToken);
            return HealthCheckResult.Healthy();
        }
        catch (Exception ex) when (ex is SqliteException or InvalidOperationException)
        {
            return HealthCheckResult.Unhealthy("The database cannot be read.", ex);
        }
    }
}
