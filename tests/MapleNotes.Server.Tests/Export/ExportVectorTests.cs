using System.IO.Compression;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using MapleNotes.Server.Domain;
using MapleNotes.Server.Features.Encryption;
using MapleNotes.Server.Features.Notes;
using MapleNotes.Server.Infrastructure.Persistence;
using MapleNotes.Server.Infrastructure.Storage;
using MapleNotes.Server.Tests.TestSupport;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace MapleNotes.Server.Tests.Export;

/// <summary>
/// Shared export vectors: the server's export archives for a tricky dataset, which the web app's export (used by
/// accounts whose notes only the browser can read) must reproduce entry by entry
/// (<c>src/maple-web/src/export/export.test.ts</c>). Run with <c>MAPLE_WRITE_VECTORS=1</c> to regenerate
/// <c>src/maple-web/src/export/export-vectors.json</c> after an intentional change to the export format.
/// </summary>
public sealed class ExportVectorTests
{
    private const string TimeZone = "Europe/Paris";

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { WriteIndented = true };

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task Server_exports_match_the_shared_export_vectors()
    {
        var computed = JsonSerializer.Serialize(await ComputeAsync(), Json) + "\n";
        var path = Path.Combine(RepositoryRoot(), "src", "maple-web", "src", "export", "export-vectors.json");
        if (Environment.GetEnvironmentVariable("MAPLE_WRITE_VECTORS") == "1")
        {
            await File.WriteAllTextAsync(path, computed, Ct);
            return;
        }

        Assert.Equal((await File.ReadAllTextAsync(path, Ct)).ReplaceLineEndings("\n"), computed);
    }

    private static async Task<JsonObject> ComputeAsync()
    {
        await using var app = new MapleAppFactory();
        using var client = new ApiClient(app);
        await client.SignUpAsync("maple");
        (await client.PutJsonAsync("/api/v1/account/encryption",
            new UpdateEncryptionRequest(EncryptionMode.Off, await client.ProofAsync()))).EnsureSuccessStatusCode();

        // A fixed dataset (IDs, times, files) written directly, so every run exports exactly the same archives.
        var files = new SortedDictionary<Guid, byte[]>();
        using (var scope = app.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<MapleDbContext>();
            var notes = scope.ServiceProvider.GetRequiredService<NoteService>();
            var store = scope.ServiceProvider.GetRequiredService<AttachmentStore>();
            var userId = (await db.Users.SingleAsync(Ct)).Id;
            var sequence = 0;

            async Task<Attachment> File(string name, string type, byte[] content, string createdAtUtc)
            {
                var id = Guid.Parse($"0192f3a3-0000-7000-8000-{++sequence:D12}");
                var storageKey = AttachmentStore.CreateStorageKey(id);
                await store.WriteAsync(storageKey, (file, ct) => file.WriteAsync(content, ct).AsTask(), cancellationToken: Ct);
                files[id] = content;
                return new Attachment
                {
                    Id = id, UserId = userId, FileName = name, ContentType = type, SizeBytes = content.Length,
                    StorageKey = storageKey, Scheme = ContentScheme.None, CreatedAtUtc = Utc(createdAtUtc),
                };
            }

            async Task Note(string text, string createdAtUtc, string? updatedAtUtc = null, bool pinned = false, bool archived = false, params Attachment[] attachments)
            {
                var note = new Note
                {
                    Id = Guid.Parse($"0192f3a2-0000-7000-8000-{++sequence:D12}"),
                    UserId = userId,
                    IsPinned = pinned,
                    ArchivedAtUtc = archived ? Utc(createdAtUtc) : null,
                    CreatedAtUtc = Utc(createdAtUtc),
                    UpdatedAtUtc = Utc(updatedAtUtc ?? createdAtUtc),
                };
                await notes.ApplyPlainTextAsync(note, text, Ct); // text and tags, as the app stores them
                note.Attachments.AddRange(attachments);
                db.Notes.Add(note);
                await db.SaveChangesAsync(Ct);
            }

            // In Paris this is already 2025-01-01: folders follow the export's time zone.
            await Note("# Meeting notes\n\n- discuss #work/meetings\n- budget", "2024-12-31T23:30:00Z");
            // Around the switch to summer time in Paris (2025-03-30, 01:00 UTC), and a slug collision in the same minute.
            await Note("Buy **maple** syrup! #groceries 🍁", "2025-03-30T00:59:00Z", "2025-03-30T01:30:00.5Z");
            await Note("Buy maple syrup", "2025-03-30T01:59:30Z");
            await Note("Buy maple syrup", "2025-03-30T01:59:50Z");
            await Note("#only #tags", "2025-04-01T08:00:00Z");
            await Note("- [ ] Quote \"this\", back\\slash,\ttab, <b>&amp;</b>, 'apostrophe', line\u2028separator, bell\u0007", "2025-04-02T08:00:00Z");
            await Note("Café résumé — naïve 日本語テキスト\nsecond line #voyage", "2025-07-14T12:00:00Z", pinned: true, attachments:
            [
                await File("photo.png", "image/png", Encoding.ASCII.GetBytes("\u0089PNG fake image bytes"), "2025-07-14T12:00:01Z"),
                await File("Café menu (2).pdf", "application/pdf", Encoding.UTF8.GetBytes("%PDF-1.7 menu"), "2025-07-14T12:00:02Z"),
                await File("con.txt", "text/plain", Encoding.UTF8.GetBytes("reserved name"), "2025-07-14T12:00:03Z"),
                await File("[draft] plan.txt", "text/plain", Encoding.UTF8.GetBytes("draft"), "2025-07-14T12:00:04Z"),
            ]);
            await Note(string.Empty, "2025-08-01T09:00:00Z", attachments: [await File("notes.txt", "text/plain", Encoding.UTF8.GetBytes("only a file"), "2025-08-01T09:00:01Z")]);
            await Note("Old idea #archive-me", "2023-05-05T05:05:05Z", archived: true);
        }

        var exports = new JsonArray();
        foreach (var format in new[] { "md", "txt", "json" })
        {
            foreach (var layout in new[] { "flat", "year", "month", "day" })
            {
                exports.Add(await ExportAsync(client, $"format={format}&layout={layout}&includeArchived=true&timeZone={Uri.EscapeDataString(TimeZone)}"));
            }
        }

        exports.Add(await ExportAsync(client, "format=md&layout=month&from=2025-03-30&to=2025-07-14&includeAttachments=false"));

        return new JsonObject
        {
            ["account"] = "maple",
            ["active"] = JsonSerializer.SerializeToNode(await client.GetJsonAsync<NotePageResponse>("/api/v1/notes?state=active&limit=100"), ApiClient.Json),
            ["archived"] = JsonSerializer.SerializeToNode(await client.GetJsonAsync<NotePageResponse>("/api/v1/notes?state=archived&limit=100"), ApiClient.Json),
            ["files"] = new JsonObject(files.Select(f => KeyValuePair.Create(f.Key.ToString(), (JsonNode?)Convert.ToBase64String(f.Value)))),
            ["exports"] = exports,
        };
    }

    private static DateTime Utc(string value) =>
        DateTime.Parse(value, System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.AdjustToUniversal);

    /// <summary>One export: its query and every entry (text, or base64 for binary files), in archive order.</summary>
    private static async Task<JsonObject> ExportAsync(ApiClient client, string query)
    {
        var response = await client.GetAsync($"/api/v1/export?{query}");
        response.EnsureSuccessStatusCode();
        using var zip = new ZipArchive(await response.Content.ReadAsStreamAsync(Ct), ZipArchiveMode.Read);
        var entries = new JsonObject();
        foreach (var entry in zip.Entries)
        {
            await using var stream = await entry.OpenAsync(Ct);
            using var buffer = new MemoryStream();
            await stream.CopyToAsync(buffer, Ct);
            var bytes = buffer.ToArray();
            var text = Path.GetExtension(entry.FullName) is ".md" or ".json" || (Path.GetExtension(entry.FullName) == ".txt" && !entry.FullName.StartsWith("attachments/", StringComparison.Ordinal))
                ? Encoding.UTF8.GetString(bytes)
                : "base64:" + Convert.ToBase64String(bytes);
            entries[entry.FullName] = entry.FullName == "manifest.json" ? WithoutExportTime(text) : text;
        }

        return new JsonObject { ["query"] = query, ["entries"] = entries };
    }

    /// <summary>The export time is the only part that differs between two exports of the same data.</summary>
    private static string WithoutExportTime(string manifest) =>
        Regex.Replace(manifest, "\"exportedAt\": \"[^\"]+\"", "\"exportedAt\": \"EXPORTED_AT\"");

    private static async Task SetAsync<T>(MapleAppFactory app, Func<MapleDbContext, IQueryable<T>> select, Action<T> change)
        where T : class
    {
        using var scope = app.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<MapleDbContext>();
        var entity = await select(db).SingleAsync(Ct);
        change(entity);
        await db.SaveChangesAsync(Ct);
    }

    private static string RepositoryRoot()
    {
        var root = new DirectoryInfo(AppContext.BaseDirectory);
        while (root is not null && !File.Exists(Path.Combine(root.FullName, "MapleNotes.slnx")))
        {
            root = root.Parent;
        }

        return root!.FullName;
    }
}
