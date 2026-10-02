using System.IO.Compression;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using MapleNotes.Server.Domain;
using MapleNotes.Server.Features.Encryption;
using MapleNotes.Server.Features.Labels;
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
    private const string AllKinds = "kind=note&kind=todo&kind=quick&kind=habit";

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

            Label Label(string name, string color)
            {
                var label = new Label
                {
                    Id = Guid.Parse($"0192f3a4-0000-7000-8000-{++sequence:D12}"), UserId = userId, Name = name, Color = color,
                    CreatedAtUtc = Utc("2025-01-01T00:00:00Z"),
                };
                db.Labels.Add(label);
                return label;
            }

            async Task Note(
                string text, string createdAtUtc, string? updatedAtUtc = null, bool pinned = false, bool archived = false,
                NoteKind kind = NoteKind.Note, string? daily = null, Label[]? labels = null, params Attachment[] attachments)
            {
                var note = new Note
                {
                    Id = Guid.Parse($"0192f3a2-0000-7000-8000-{++sequence:D12}"),
                    UserId = userId,
                    Kind = kind,
                    DailyDate = daily is null ? null : DateOnly.Parse(daily, System.Globalization.CultureInfo.InvariantCulture),
                    IsPinned = pinned,
                    ArchivedAtUtc = archived ? Utc(createdAtUtc) : null,
                    CreatedAtUtc = Utc(createdAtUtc),
                    UpdatedAtUtc = Utc(updatedAtUtc ?? createdAtUtc),
                };
                await notes.ApplyPlainTextAsync(note, text, Ct); // text and tags, as the app stores them
                note.Attachments.AddRange(attachments);
                note.Labels.AddRange(labels ?? []);
                db.Notes.Add(note);
                await db.SaveChangesAsync(Ct);
            }

            // Added in 1.9: labels, with names that need escaping and sort differently by code unit than by culture, and
            // one on no note, which exports leave out.
            var work = Label("Work", "Blue");
            var summer = Label("été ☀️", "Orange");
            var quoted = Label("Zebra, \"quoted\" #1", "Pink");
            Label("Unused", "Grey");

            // In Paris this is already 2025-01-01: folders follow the export's time zone.
            await Note("# Meeting notes\n\n- discuss #work/meetings\n- budget", "2024-12-31T23:30:00Z", labels: [work]);
            // Around the switch to summer time in Paris (2025-03-30, 01:00 UTC), and a slug collision in the same minute.
            await Note("Buy **maple** syrup! #groceries 🍁", "2025-03-30T00:59:00Z", "2025-03-30T01:30:00.5Z");
            await Note("Buy maple syrup", "2025-03-30T01:59:30Z");
            await Note("Buy maple syrup", "2025-03-30T01:59:50Z");
            await Note("#only #tags", "2025-04-01T08:00:00Z");
            await Note("- [ ] Quote \"this\", back\\slash,\ttab, <b>&amp;</b>, 'apostrophe', line\u2028separator, bell\u0007", "2025-04-02T08:00:00Z");
            await Note("Café résumé — naïve 日本語テキスト\nsecond line #voyage", "2025-07-14T12:00:00Z", pinned: true, labels: [work, summer, quoted], attachments:
            [
                await File("photo.png", "image/png", Encoding.ASCII.GetBytes("\u0089PNG fake image bytes"), "2025-07-14T12:00:01Z"),
                await File("Café menu (2).pdf", "application/pdf", Encoding.UTF8.GetBytes("%PDF-1.7 menu"), "2025-07-14T12:00:02Z"),
                await File("con.txt", "text/plain", Encoding.UTF8.GetBytes("reserved name"), "2025-07-14T12:00:03Z"),
                await File("[draft] plan.txt", "text/plain", Encoding.UTF8.GetBytes("draft"), "2025-07-14T12:00:04Z"),
            ]);
            await Note(string.Empty, "2025-08-01T09:00:00Z", attachments: [await File("notes.txt", "text/plain", Encoding.UTF8.GetBytes("only a file"), "2025-08-01T09:00:01Z")]);
            await Note("Old idea #archive-me", "2023-05-05T05:05:05Z", archived: true, labels: [summer]);
            // Added in 1.2: a todo list, a quick note (archived) and a daily note, whose day is the author's local date.
            await Note("# Groceries\n\n- [x] oats\n- [ ] maple syrup #groceries", "2025-07-14T08:00:00Z", kind: NoteKind.Todo);
            await Note("Call the plumber", "2025-07-14T09:00:00Z", archived: true, kind: NoteKind.Quick);
            await Note("# Tuesday, 15 July 2025\n\nA quiet day", "2025-07-14T22:30:00Z", daily: "2025-07-15");
            // Added in 1.3: a habit, ticked on three days, the last after it was created.
            await Note("# Stretch 🧘\n\n- 2025-07-12\n- 2025-07-13\n- 2025-07-15", "2025-07-13T06:45:00Z", "2025-07-15T06:50:00Z", kind: NoteKind.Habit, labels: [quoted]);
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
            ["active"] = JsonSerializer.SerializeToNode(await client.GetJsonAsync<NotePageResponse>($"/api/v1/notes?state=active&limit=100&{AllKinds}"), ApiClient.Json),
            ["archived"] = JsonSerializer.SerializeToNode(await client.GetJsonAsync<NotePageResponse>($"/api/v1/notes?state=archived&limit=100&{AllKinds}"), ApiClient.Json),
            ["labels"] = JsonSerializer.SerializeToNode(await client.GetJsonAsync<List<LabelResponse>>("/api/v1/labels"), ApiClient.Json),
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
