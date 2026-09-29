using System.IO.Compression;
using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using MapleNotes.Server.Features.Attachments;
using MapleNotes.Server.Features.Export;
using MapleNotes.Server.Features.Notes;
using MapleNotes.Server.Infrastructure.Configuration;
using MapleNotes.Server.Infrastructure.Persistence;
using MapleNotes.Server.Tests.TestSupport;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace MapleNotes.Server.Tests.Export;

public sealed partial class ExportTests : IAsyncLifetime
{
    private readonly MapleAppFactory _app = new() { Settings = { [MapleOptions.AllowRegistrationKey] = "true" } };
    private readonly byte[] _image = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, .. RandomNumberGenerator.GetBytes(90_000)];
    private readonly byte[] _pdf = [.. "%PDF-1.7\n"u8, .. RandomNumberGenerator.GetBytes(5_000)];
    private ApiClient _client = null!;

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    public async ValueTask InitializeAsync()
    {
        _client = new ApiClient(_app);
        await _client.SignUpAsync("maple");

        var image = await UploadAsync(_image, "sunset.png", "image/png");
        var pdf = await UploadAsync(_pdf, "report final.pdf", "application/pdf");
        var groceries = await CreateAsync("Buy **maple** syrup #groceries", [image.Id, pdf.Id]);
        var trip = await CreateAsync("# Trip notes\nDay one: drove north. #travel");
        var tripAgain = await CreateAsync("Trip notes");
        var archived = await CreateAsync("old idea");
        var lateNight = await CreateAsync("Late night thought");
        await _client.PatchJsonAsync($"/api/v1/notes/{archived.Id}", new PatchNoteRequest(IsArchived: true));

        using var other = new ApiClient(_app);
        await other.SignUpAsync("other");
        await other.PostJsonAsync("/api/v1/notes", new CreateNoteRequest("someone else's note"));

        await SetCreatedAsync(groceries.Id, new DateTime(2026, 8, 14, 9, 30, 0, DateTimeKind.Utc));
        await SetCreatedAsync(trip.Id, new DateTime(2026, 9, 2, 18, 12, 0, DateTimeKind.Utc));
        await SetCreatedAsync(tripAgain.Id, new DateTime(2026, 9, 2, 18, 12, 30, DateTimeKind.Utc));
        await SetCreatedAsync(archived.Id, new DateTime(2026, 7, 1, 12, 0, 0, DateTimeKind.Utc));
        await SetCreatedAsync(lateNight.Id, new DateTime(2026, 9, 30, 23, 30, 0, DateTimeKind.Utc));
    }

    public static TheoryData<string, string> FormatsAndLayouts()
    {
        var data = new TheoryData<string, string>();
        foreach (var format in new[] { "md", "txt", "json" })
        {
            foreach (var layout in new[] { "flat", "year", "month", "day" })
            {
                data.Add(format, layout);
            }
        }

        return data;
    }

    [Theory]
    [MemberData(nameof(FormatsAndLayouts))]
    public async Task Every_format_and_layout_produces_decrypted_notes_attachments_and_working_links(string format, string layout)
    {
        using var zip = await ExportAsync($"format={format}&layout={layout}");
        var entries = zip.Entries.Select(e => e.FullName).ToHashSet();

        string Folder(string day) => layout switch
        {
            "year" => day[..4] + "/",
            "month" => day[..7] + "/",
            "day" => day + "/",
            _ => string.Empty,
        };

        var groceriesPath = $"{Folder("2026-08-14")}2026-08-14_0930_buy-maple-syrup.{format}";
        var expectedNotes = new[]
        {
            groceriesPath,
            $"{Folder("2026-09-02")}2026-09-02_1812_trip-notes.{format}",
            $"{Folder("2026-09-02")}2026-09-02_1812_trip-notes-2.{format}",
            $"{Folder("2026-09-30")}2026-09-30_2330_late-night-thought.{format}",
        };
        Assert.Superset(expectedNotes.ToHashSet(), entries);
        Assert.Contains("manifest.json", entries);

        // Decrypted, byte-identical attachments.
        var image = Assert.Single(zip.Entries, e => Regex.IsMatch(e.FullName, "^attachments/[0-9a-f]{8}_sunset\\.png$"));
        var pdf = Assert.Single(zip.Entries, e => Regex.IsMatch(e.FullName, "^attachments/[0-9a-f]{8}_report-final\\.pdf$"));
        Assert.Equal(_image, await ReadBytesAsync(image));
        Assert.Equal(_pdf, await ReadBytesAsync(pdf));

        // Decrypted note content, and links that resolve to real entries from the note's own folder.
        var groceries = await ReadTextAsync(zip.GetEntry(groceriesPath)!);
        var links = format switch
        {
            "md" => MarkdownLink().Matches(groceries).Select(m => Uri.UnescapeDataString(m.Groups[1].Value)).ToList(),
            "txt" => TextAttachmentLine().Matches(groceries).Select(m => m.Groups[1].Value.Trim()).ToList(),
            _ => JsonDocument.Parse(groceries).RootElement.GetProperty("attachments").EnumerateArray()
                .Select(a => a.GetProperty("path").GetString()!).ToList(),
        };
        if (format == "json")
        {
            Assert.Equal("Buy **maple** syrup #groceries", JsonDocument.Parse(groceries).RootElement.GetProperty("content").GetString());
        }
        else
        {
            Assert.Contains("Buy **maple** syrup #groceries", groceries, StringComparison.Ordinal);
        }

        Assert.Equal(2, links.Count);
        Assert.All(links, link => Assert.Contains(Resolve(groceriesPath, link), entries));

        // Only this user's active notes.
        var manifest = JsonDocument.Parse(await ReadTextAsync(zip.GetEntry("manifest.json")!)).RootElement;
        Assert.Equal(4, manifest.GetProperty("noteCount").GetInt32());
        Assert.Equal(2, manifest.GetProperty("attachmentCount").GetInt32());
        Assert.Equal("maple", manifest.GetProperty("account").GetString());
        Assert.Empty(manifest.GetProperty("problems").EnumerateArray());
        foreach (var entry in zip.Entries.Where(e => !e.FullName.StartsWith("attachments/", StringComparison.Ordinal)))
        {
            var text = await ReadTextAsync(entry);
            Assert.DoesNotContain("someone else", text, StringComparison.Ordinal);
            Assert.DoesNotContain("old idea", text, StringComparison.Ordinal);
        }
    }

    [Fact]
    public async Task Markdown_carries_front_matter_and_embeds_images()
    {
        using var zip = await ExportAsync("format=md&layout=month");

        var note = await ReadTextAsync(zip.GetEntry("2026-08/2026-08-14_0930_buy-maple-syrup.md")!);

        Assert.StartsWith("---\nid: ", note, StringComparison.Ordinal);
        Assert.Contains("created: 2026-08-14T09:30:00+00:00", note, StringComparison.Ordinal);
        Assert.Contains("tags: [\"groceries\"]", note, StringComparison.Ordinal);
        Assert.Matches(@"- !\[sunset\.png\]\(\.\./attachments/[0-9a-f]{8}_sunset\.png\)", note);
        Assert.Matches(@"- \[report final\.pdf\]\(\.\./attachments/[0-9a-f]{8}_report-final\.pdf\)", note);
    }

    [Fact]
    public async Task Archived_notes_are_included_on_request()
    {
        using var zip = await ExportAsync("format=md&layout=flat&includeArchived=true");

        var archived = await ReadTextAsync(zip.GetEntry("2026-07-01_1200_old-idea.md")!);

        Assert.Contains("archived: true", archived, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Date_range_and_folders_follow_the_requested_time_zone()
    {
        using var zip = await ExportAsync("format=txt&layout=month&from=2026-10-01&to=2026-10-01&timeZone=Asia/Tokyo");

        var note = Assert.Single(zip.Entries, e => e.FullName != "manifest.json");
        Assert.Equal("2026-10/2026-10-01_0830_late-night-thought.txt", note.FullName); // 23:30 UTC is 08:30 next day in Tokyo
        Assert.Contains("Created: 2026-10-01T08:30:00+09:00", await ReadTextAsync(note), StringComparison.Ordinal);
        var manifest = JsonDocument.Parse(await ReadTextAsync(zip.GetEntry("manifest.json")!)).RootElement;
        Assert.Equal("Asia/Tokyo", manifest.GetProperty("options").GetProperty("timeZone").GetString());
    }

    [Fact]
    public async Task Attachments_can_be_left_out()
    {
        using var zip = await ExportAsync("format=md&layout=flat&includeAttachments=false");

        Assert.DoesNotContain(zip.Entries, e => e.FullName.StartsWith("attachments/", StringComparison.Ordinal));
        Assert.DoesNotContain("## Attachments", await ReadTextAsync(zip.GetEntry("2026-08-14_0930_buy-maple-syrup.md")!), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Download_is_named_and_never_cached()
    {
        var response = await _client.GetAsync("/api/v1/export");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("application/zip", response.Content.Headers.ContentType!.MediaType);
        Assert.Matches(@"^maple-notes-\d{4}-\d{2}-\d{2}\.zip$", response.Content.Headers.ContentDisposition!.FileName!.Trim('"'));
        Assert.Contains("no-store", response.Headers.CacheControl!.ToString(), StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("timeZone=Mars/Olympus_Mons", "timeZone")]
    [InlineData("from=2026-10-02&to=2026-10-01", "from")]
    public async Task Invalid_options_are_rejected_before_anything_is_sent(string query, string field)
    {
        var response = await _client.GetAsync($"/api/v1/export?{query}");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains(field, (await response.Content.ReadFromJsonAsync<ValidationProblemDetails>(ApiClient.Json, Ct))!.Errors.Keys);
    }

    [Fact]
    public async Task Unknown_formats_are_rejected()
    {
        var response = await _client.GetAsync("/api/v1/export?format=pdf");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Export_requires_sign_in()
    {
        using var anonymous = _app.CreateClient();

        var response = await anonymous.GetAsync("/api/v1/export", Ct);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    public async ValueTask DisposeAsync()
    {
        _client.Dispose();
        await _app.DisposeAsync();
    }

    private async Task<ZipArchive> ExportAsync(string query)
    {
        var response = await _client.GetAsync($"/api/v1/export?{query}");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var bytes = await response.Content.ReadAsByteArrayAsync(Ct);
        return new ZipArchive(new MemoryStream(bytes), ZipArchiveMode.Read);
    }

    private async Task<AttachmentResponse> UploadAsync(byte[] content, string fileName, string contentType)
    {
        var response = await _client.UploadAsync(content, fileName, contentType);
        return (await response.Content.ReadFromJsonAsync<AttachmentResponse>(ApiClient.Json, Ct))!;
    }

    private async Task<NoteResponse> CreateAsync(string content, IReadOnlyList<Guid>? attachmentIds = null)
    {
        var response = await _client.PostJsonAsync("/api/v1/notes", new CreateNoteRequest(content, attachmentIds));
        return (await response.Content.ReadFromJsonAsync<NoteResponse>(ApiClient.Json, Ct))!;
    }

    private async Task SetCreatedAsync(Guid noteId, DateTime createdUtc)
    {
        using var scope = _app.Services.CreateScope();
        await scope.ServiceProvider.GetRequiredService<MapleDbContext>().Notes
            .Where(n => n.Id == noteId)
            .ExecuteUpdateAsync(set => set.SetProperty(n => n.CreatedAtUtc, createdUtc).SetProperty(n => n.UpdatedAtUtc, createdUtc), Ct);
    }

    private static async Task<byte[]> ReadBytesAsync(ZipArchiveEntry entry)
    {
        await using var stream = await entry.OpenAsync(Ct);
        using var buffer = new MemoryStream();
        await stream.CopyToAsync(buffer, Ct);
        return buffer.ToArray();
    }

    private static async Task<string> ReadTextAsync(ZipArchiveEntry entry) => Encoding.UTF8.GetString(await ReadBytesAsync(entry));

    /// <summary>Resolves a relative link against the folder of the file containing it.</summary>
    private static string Resolve(string fromFile, string relative)
    {
        var parts = fromFile.Split('/').SkipLast(1).ToList();
        foreach (var segment in relative.Split('/'))
        {
            if (segment == "..")
            {
                parts.RemoveAt(parts.Count - 1);
            }
            else
            {
                parts.Add(segment);
            }
        }

        return string.Join('/', parts);
    }

    [GeneratedRegex(@"\]\(([^)]+)\)")]
    private static partial Regex MarkdownLink();

    [GeneratedRegex(@"^Attachment: (.+)$", RegexOptions.Multiline)]
    private static partial Regex TextAttachmentLine();
}

public sealed class ExportNamingTests
{
    [Theory]
    [InlineData("# Buy **maple** syrup!", "buy-maple-syrup")]
    [InlineData("Buy syrup #groceries #today", "buy-syrup")]
    [InlineData("#todo #urgent", "todo-urgent")]
    [InlineData("- [ ] Call the plumber", "call-the-plumber")]
    [InlineData("1. First step", "first-step")]
    [InlineData("> quoted wisdom", "quoted-wisdom")]
    [InlineData("\n\n  Second line wins\nthird", "second-line-wins")]
    [InlineData("Café crème", "café-crème")]
    [InlineData("日本語のメモ", "日本語のメモ")]
    [InlineData("It's done", "its-done")]
    [InlineData("!!!", "note")]
    [InlineData("", "note")]
    public void Slugs_come_from_the_first_line(string content, string expected)
    {
        Assert.Equal(expected, ExportNaming.Slug(content));
    }

    [Fact]
    public void Slugs_are_bounded()
    {
        Assert.True(ExportNaming.Slug(string.Join(' ', Enumerable.Repeat("word", 50))).Length <= 60);
    }

    [Theory]
    [InlineData("report final.pdf", "report-final.pdf")]
    [InlineData("CON.txt", "_CON.txt")]
    [InlineData("nul", "_nul")]
    [InlineData("a:b*c?.png", "a-b-c-.png")]
    [InlineData("  ..hidden  ", "hidden")]
    [InlineData("", "file")]
    public void Attachment_names_are_safe_everywhere(string input, string expected)
    {
        Assert.Equal(expected, ExportNaming.SafeFileName(input));
    }

    [Theory]
    [InlineData("note.md", "attachments/a.png", "attachments/a.png")]
    [InlineData("2026-09/note.md", "attachments/a.png", "../attachments/a.png")]
    public void Relative_paths_climb_out_of_the_note_folder(string from, string to, string expected)
    {
        Assert.Equal(expected, ExportNaming.RelativePath(from, to));
    }

    [Fact]
    public void Paths_are_made_unique_ignoring_case()
    {
        var used = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        Assert.Equal("a/note.md", ExportNaming.Unique("a/note.md", used));
        Assert.Equal("a/Note-2.md", ExportNaming.Unique("a/Note.md", used));
        Assert.Equal("a/note-3.md", ExportNaming.Unique("a/note.md", used));
    }

    [Fact]
    public void Link_targets_are_percent_encoded_but_keep_slashes()
    {
        Assert.Equal("../attachments/caf%C3%A9%20menu.pdf", ExportNaming.LinkTarget("../attachments/café menu.pdf"));
    }
}
