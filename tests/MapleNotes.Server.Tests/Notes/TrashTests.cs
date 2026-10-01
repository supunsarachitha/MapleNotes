using System.Net;
using System.Net.Http.Json;
using MapleNotes.Server.Domain;
using MapleNotes.Server.Features.Attachments;
using MapleNotes.Server.Features.Notes;
using MapleNotes.Server.Infrastructure.Configuration;
using MapleNotes.Server.Infrastructure.Persistence;
using MapleNotes.Server.Tests.TestSupport;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace MapleNotes.Server.Tests.Notes;

/// <summary>
/// The trash: notes moved there leave every other list, come back to where they were when restored, and are deleted for
/// good when the trash is emptied or after 30 days.
/// </summary>
public sealed class TrashTests : IAsyncLifetime
{
    private const string AllKinds = "kind=note&kind=todo&kind=quick&kind=habit";
    private readonly MapleAppFactory _app = new() { Settings = { [MapleOptions.AllowRegistrationKey] = "true" } };
    private ApiClient _client = null!;

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    public async ValueTask InitializeAsync()
    {
        _client = new ApiClient(_app);
        await _client.SignUpAsync("maple");
    }

    public async ValueTask DisposeAsync()
    {
        _client.Dispose();
        await _app.DisposeAsync();
    }

    [Fact]
    public async Task A_note_in_the_trash_is_listed_only_there()
    {
        var trashed = await CreateAsync("Plans for the #orchard", pinned: true);
        var kept = await CreateAsync("Kept #orchard");

        var patched = await PatchAsync(trashed.Id, new PatchNoteRequest(IsTrashed: true));

        Assert.NotNull(patched.TrashedAtUtc);
        Assert.Equal([kept.Id], await IdsAsync($"/api/v1/notes?state=active&{AllKinds}"));
        Assert.Empty(await IdsAsync("/api/v1/notes?state=pinned"));
        Assert.Equal([kept.Id], await IdsAsync("/api/v1/notes?state=feed"));
        Assert.Equal([kept.Id], await IdsAsync("/api/v1/notes?state=active&q=orchard"));
        Assert.Equal([kept.Id], await IdsAsync("/api/v1/notes?state=active&tag=orchard"));
        Assert.Equal([trashed.Id], await IdsAsync($"/api/v1/notes?state=trash&{AllKinds}"));
        Assert.Equal(1, (await _client.GetJsonAsync<List<TagResponse>>("/api/v1/tags"))!.Single().NoteCount);
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var days = await _client.GetJsonAsync<List<CalendarDayResponse>>($"/api/v1/notes/calendar?from={today.AddDays(-1):yyyy-MM-dd}&to={today.AddDays(1):yyyy-MM-dd}");
        Assert.Equal(1, days!.Sum(d => d.Count));
    }

    [Fact]
    public async Task Restoring_puts_a_note_back_where_it_was()
    {
        var archived = await CreateAsync("Archived first");
        await PatchAsync(archived.Id, new PatchNoteRequest(IsArchived: true));
        var pinned = await CreateAsync("Pinned first", pinned: true);
        await PatchAsync(archived.Id, new PatchNoteRequest(IsTrashed: true));
        await PatchAsync(pinned.Id, new PatchNoteRequest(IsTrashed: true));

        var restored = await PatchAsync(archived.Id, new PatchNoteRequest(IsTrashed: false));
        await PatchAsync(pinned.Id, new PatchNoteRequest(IsTrashed: false));

        Assert.Null(restored.TrashedAtUtc);
        Assert.True(restored.IsArchived);
        Assert.Equal([archived.Id], await IdsAsync("/api/v1/notes?state=archived"));
        Assert.Equal([pinned.Id], await IdsAsync("/api/v1/notes?state=pinned"));
        Assert.Empty(await IdsAsync($"/api/v1/notes?state=trash&{AllKinds}"));
    }

    [Fact]
    public async Task The_trash_lists_the_most_recently_deleted_first_one_page_at_a_time()
    {
        var notes = new List<NoteResponse>();
        for (var i = 0; i < 5; i++)
        {
            notes.Add(await CreateAsync($"note {i}"));
        }

        // Deleted in a different order from the one they were written in.
        foreach (var index in new[] { 3, 0, 4, 1, 2 })
        {
            await PatchAsync(notes[index].Id, new PatchNoteRequest(IsTrashed: true));
        }

        var first = (await _client.GetJsonAsync<NotePageResponse>("/api/v1/notes?state=trash&limit=2"))!;
        var second = (await _client.GetJsonAsync<NotePageResponse>($"/api/v1/notes?state=trash&limit=2&cursor={first.NextCursor}"))!;
        var third = (await _client.GetJsonAsync<NotePageResponse>($"/api/v1/notes?state=trash&limit=2&cursor={second.NextCursor}"))!;

        Assert.Equal(
            new[] { 2, 1, 4, 0, 3 }.Select(i => notes[i].Id),
            first.Items.Concat(second.Items).Concat(third.Items).Select(n => n.Id));
        Assert.Null(third.NextCursor);
    }

    [Fact]
    public async Task A_daily_note_in_the_trash_gives_up_its_day()
    {
        var created = await _client.PostJsonAsync("/api/v1/notes", new CreateNoteRequest("# 1 October\n\nA day", DailyDate: new DateOnly(2026, 10, 1)));
        var daily = (await created.Content.ReadFromJsonAsync<NoteResponse>(ApiClient.Json, Ct))!;

        var trashed = await PatchAsync(daily.Id, new PatchNoteRequest(IsTrashed: true));
        var again = await _client.PostJsonAsync("/api/v1/notes", new CreateNoteRequest("# 1 October\n\nA new start", DailyDate: new DateOnly(2026, 10, 1)));
        var restored = await PatchAsync(daily.Id, new PatchNoteRequest(IsTrashed: false));

        Assert.Null(trashed.DailyDate);
        Assert.Equal(HttpStatusCode.Created, again.StatusCode);
        Assert.Null(restored.DailyDate); // an ordinary note again; the day has its new daily note
    }

    [Fact]
    public async Task Emptying_the_trash_deletes_its_notes_and_their_files_for_good()
    {
        var upload = await _client.UploadAsync([1, 2, 3], "receipt.txt", "text/plain");
        var file = (await upload.Content.ReadFromJsonAsync<AttachmentResponse>(ApiClient.Json, Ct))!;
        var created = await _client.PostJsonAsync("/api/v1/notes", new CreateNoteRequest("With a receipt #tax", [file.Id]));
        var withFile = (await created.Content.ReadFromJsonAsync<NoteResponse>(ApiClient.Json, Ct))!;
        var kept = await CreateAsync("Not in the trash");
        await PatchAsync(withFile.Id, new PatchNoteRequest(IsTrashed: true));

        var response = await _client.DeleteAsync("/api/v1/notes/trash");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(new EmptyTrashResponse(1, 1), await response.Content.ReadFromJsonAsync<EmptyTrashResponse>(ApiClient.Json, Ct));
        Assert.Equal(HttpStatusCode.NotFound, (await _client.GetAsync($"/api/v1/notes/{withFile.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await _client.GetAsync(file.Url)).StatusCode);
        Assert.Equal([kept.Id], await IdsAsync("/api/v1/notes?state=active"));
        Assert.Empty((await _client.GetJsonAsync<List<TagResponse>>("/api/v1/tags"))!); // its tag went with it
    }

    [Fact]
    public async Task Emptying_the_trash_leaves_other_accounts_alone()
    {
        using var other = new ApiClient(_app);
        await other.SignUpAsync("other");
        var theirs = (await (await other.PostJsonAsync("/api/v1/notes", new CreateNoteRequest("Theirs"))).Content.ReadFromJsonAsync<NoteResponse>(ApiClient.Json, Ct))!;
        (await other.PatchJsonAsync($"/api/v1/notes/{theirs.Id}", new PatchNoteRequest(IsTrashed: true))).EnsureSuccessStatusCode();

        (await _client.DeleteAsync("/api/v1/notes/trash")).EnsureSuccessStatusCode();

        Assert.Equal([theirs.Id], (await other.GetJsonAsync<NotePageResponse>("/api/v1/notes?state=trash"))!.Items.Select(n => n.Id));
        Assert.Equal(HttpStatusCode.NotFound, (await _client.PatchJsonAsync($"/api/v1/notes/{theirs.Id}", new PatchNoteRequest(IsTrashed: false))).StatusCode);
    }

    [Fact]
    public async Task Notes_in_the_trash_for_over_30_days_are_deleted_for_good()
    {
        var old = await CreateAsync("Deleted long ago");
        var recent = await CreateAsync("Deleted yesterday");
        await PatchAsync(old.Id, new PatchNoteRequest(IsTrashed: true));
        await PatchAsync(recent.Id, new PatchNoteRequest(IsTrashed: true));
        await SetTrashedAtAsync(old.Id, DateTime.UtcNow.AddDays(-31));
        await SetTrashedAtAsync(recent.Id, DateTime.UtcNow.AddDays(-1));

        EmptyTrashResponse purged;
        using (var scope = _app.Services.CreateScope())
        {
            purged = await scope.ServiceProvider.GetRequiredService<NoteService>().PurgeExpiredTrashAsync(Ct);
        }

        Assert.Equal(new EmptyTrashResponse(1, 0), purged);
        Assert.Equal([recent.Id], await IdsAsync("/api/v1/notes?state=trash"));
    }

    [Fact]
    public async Task Exports_leave_the_trash_out()
    {
        await CreateAsync("Exported");
        var trashed = await CreateAsync("Thrown away");
        await PatchAsync(trashed.Id, new PatchNoteRequest(IsTrashed: true));

        var response = await _client.GetAsync("/api/v1/export?format=json&includeArchived=true");
        using var zip = new System.IO.Compression.ZipArchive(await response.Content.ReadAsStreamAsync(Ct));
        var texts = new List<string>();
        foreach (var entry in zip.Entries.Where(e => e.FullName != "manifest.json"))
        {
            using var reader = new StreamReader(await entry.OpenAsync(Ct));
            texts.Add(await reader.ReadToEndAsync(Ct));
        }

        Assert.Contains(texts, text => text.Contains("Exported", StringComparison.Ordinal));
        Assert.DoesNotContain(texts, text => text.Contains("Thrown away", StringComparison.Ordinal));
    }

    private async Task<NoteResponse> CreateAsync(string content, bool pinned = false)
    {
        var response = await _client.PostJsonAsync("/api/v1/notes", new CreateNoteRequest(content, IsPinned: pinned));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<NoteResponse>(ApiClient.Json, Ct))!;
    }

    private async Task<NoteResponse> PatchAsync(Guid id, PatchNoteRequest request)
    {
        var response = await _client.PatchJsonAsync($"/api/v1/notes/{id}", request);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<NoteResponse>(ApiClient.Json, Ct))!;
    }

    private async Task<List<Guid>> IdsAsync(string url) =>
        (await _client.GetJsonAsync<NotePageResponse>(url))!.Items.Select(n => n.Id).ToList();

    private async Task SetTrashedAtAsync(Guid id, DateTime when)
    {
        using var scope = _app.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<MapleDbContext>();
        await db.Notes.Where(n => n.Id == id).ExecuteUpdateAsync(s => s.SetProperty(n => n.TrashedAtUtc, when), Ct);
    }
}
