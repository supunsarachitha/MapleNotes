using System.Text;
using MapleNotes.Server.Infrastructure.Configuration;
using MapleNotes.Server.Infrastructure.Crypto;
using MapleNotes.Server.Infrastructure.Persistence;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.DependencyInjection;

namespace MapleNotes.Server.Tests.TestSupport;

/// <summary>Looks for text in the decrypted database, as someone holding the master key could.</summary>
internal static class DatabaseScanner
{
    /// <summary>
    /// Reads every value of every table and reports where any of <paramref name="secrets"/> appears, as text or as
    /// UTF-8 inside binary values.
    /// </summary>
    public static async Task<List<string>> ScanAsync(MapleAppFactory app, params string[] secrets)
    {
        var ct = TestContext.Current.CancellationToken;
        var options = app.Services.GetRequiredService<MapleOptions>();
        using var keys = new KeyMaterial(Convert.FromBase64String(app.MasterKeyBase64));
        await using var connection = new SqliteConnection(SqlCipherConnectionString.Build(options.DatabasePath, keys.DatabaseKey, pooling: false));
        await connection.OpenAsync(ct);

        var tables = new List<string>();
        await using (var list = connection.CreateCommand())
        {
            list.CommandText = "SELECT name FROM sqlite_master WHERE type = 'table'";
            await using var reader = await list.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                tables.Add(reader.GetString(0));
            }
        }

        var leaks = new List<string>();
        foreach (var table in tables)
        {
            await using var select = connection.CreateCommand();
            select.CommandText = $"SELECT * FROM \"{table}\"";
            await using var reader = await select.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                for (var column = 0; column < reader.FieldCount; column++)
                {
                    var bytes = reader.GetValue(column) switch
                    {
                        string text => Encoding.UTF8.GetBytes(text),
                        byte[] blob => blob,
                        _ => [],
                    };
                    foreach (var secret in secrets.Where(secret => bytes.AsSpan().IndexOf(Encoding.UTF8.GetBytes(secret)) >= 0))
                    {
                        leaks.Add($"{table}.{reader.GetName(column)} contains \"{secret}\"");
                    }
                }
            }
        }

        Assert.Contains("Notes", tables); // the scan really read the database
        return leaks;
    }
}
