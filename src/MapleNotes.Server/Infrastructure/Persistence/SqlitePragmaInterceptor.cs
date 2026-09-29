using System.Data.Common;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace MapleNotes.Server.Infrastructure.Persistence;

/// <summary>
/// Applies per-connection SQLite settings every time EF Core opens a connection.
/// </summary>
/// <remarks>
/// <c>secure_delete</c> makes SQLite overwrite deleted content instead of merely marking it free, so deleted notes
/// and deleted accounts' wrapped keys do not linger inside the database file.
/// </remarks>
internal sealed class SqlitePragmaInterceptor : DbConnectionInterceptor
{
    private const string Pragmas = "PRAGMA secure_delete = ON;";

    /// <inheritdoc />
    public override void ConnectionOpened(DbConnection connection, ConnectionEndEventData eventData)
    {
        using var command = connection.CreateCommand();
        command.CommandText = Pragmas;
        command.ExecuteNonQuery();
    }

    /// <inheritdoc />
    public override async Task ConnectionOpenedAsync(
        DbConnection connection, ConnectionEndEventData eventData, CancellationToken cancellationToken = default)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = Pragmas;
        await command.ExecuteNonQueryAsync(cancellationToken);
    }
}
