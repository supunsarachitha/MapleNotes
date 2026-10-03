using System.Data.Common;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace MapleNotes.Server.Infrastructure.Persistence;

/// <summary>
/// Applies per-connection SQLite settings every time EF Core opens a connection.
/// </summary>
/// <remarks>
/// <c>secure_delete</c> makes SQLite overwrite deleted content instead of merely marking it free, so deleted notes
/// and deleted accounts' wrapped keys do not linger inside the database file. <c>journal_size_limit = 0</c> truncates
/// the write-ahead log after each checkpoint, so old copies of changed pages (a note's text from before it was
/// converted to end-to-end encryption, say) do not linger in <c>maple.db-wal</c> either.
/// </remarks>
internal sealed class SqlitePragmaInterceptor : DbConnectionInterceptor
{
    private const string Pragmas = "PRAGMA secure_delete = ON; PRAGMA journal_size_limit = 0;";

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
