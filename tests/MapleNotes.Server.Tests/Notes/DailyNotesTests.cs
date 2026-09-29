using System.Net;
using System.Net.Http.Json;
using MapleNotes.Server.Domain;
using MapleNotes.Server.Features.Notes;
using MapleNotes.Server.Infrastructure.Configuration;
using MapleNotes.Server.Tests.TestSupport;
using Microsoft.AspNetCore.Mvc;

namespace MapleNotes.Server.Tests.Notes;

/// <summary>Daily notes: one per account and day, found by date, and freed when deleted or moved out of the timeline.</summary>
public sealed class DailyNotesTests : IAsyncLifetime
{
    private static readonly DateOnly Today = new(2026, 9, 29);

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
    public async Task A_day_has_at_most_one_daily_note_which_is_found_by_date()
    {
        Assert.Equal(HttpStatusCode.NotFound, (await _client.GetAsync("/api/v1/notes/daily/2026-09-29")).StatusCode);

        var created = await _client.PostJsonAsync("/api/v1/notes", new CreateNoteRequest("# Tuesday\n\nFirst entry", DailyDate: Today));
        var second = await _client.PostJsonAsync("/api/v1/notes", new CreateNoteRequest("# Tuesday\n\nFrom the phone", DailyDate: Today));
        var tomorrow = await _client.PostJsonAsync("/api/v1/notes", new CreateNoteRequest("# Wednesday", DailyDate: Today.AddDays(1)));

        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, second.StatusCode);
        Assert.Equal(HttpStatusCode.Created, tomorrow.StatusCode);
        var daily = await _client.GetJsonAsync<NoteResponse>("/api/v1/notes/daily/2026-09-29");
        Assert.Equal(("# Tuesday\n\nFirst entry", Today, NoteKind.Note), (daily!.Content, daily.DailyDate, daily.Kind));
        Assert.Equal(2, (await _client.GetJsonAsync<NotePageResponse>("/api/v1/notes"))!.Items.Count); // daily notes are timeline notes
    }

    [Fact]
    public async Task Daily_notes_are_per_account()
    {
        using var other = new ApiClient(_app);
        await other.SignUpAsync("birch");
        await _client.PostJsonAsync("/api/v1/notes", new CreateNoteRequest("mine", DailyDate: Today));

        var theirs = await other.PostJsonAsync("/api/v1/notes", new CreateNoteRequest("theirs", DailyDate: Today));

        Assert.Equal(HttpStatusCode.Created, theirs.StatusCode);
        Assert.Equal("theirs", (await other.GetJsonAsync<NoteResponse>("/api/v1/notes/daily/2026-09-29"))!.Content);
    }

    [Fact]
    public async Task Deleting_or_moving_a_daily_note_frees_its_day()
    {
        var first = await CreateAsync(new CreateNoteRequest("first", DailyDate: Today));
        (await _client.DeleteAsync($"/api/v1/notes/{first.Id}")).EnsureSuccessStatusCode();
        var second = await CreateAsync(new CreateNoteRequest("second", DailyDate: Today));

        var moved = await _client.PatchJsonAsync($"/api/v1/notes/{second.Id}", new PatchNoteRequest(Kind: NoteKind.Quick));

        Assert.Null((await moved.Content.ReadFromJsonAsync<NoteResponse>(ApiClient.Json, Ct))!.DailyDate);
        Assert.Equal(HttpStatusCode.NotFound, (await _client.GetAsync("/api/v1/notes/daily/2026-09-29")).StatusCode);
        Assert.Equal(HttpStatusCode.Created, (await _client.PostJsonAsync("/api/v1/notes", new CreateNoteRequest("third", DailyDate: Today))).StatusCode);
    }

    [Fact]
    public async Task Only_timeline_notes_can_be_daily_notes_and_dates_must_be_valid()
    {
        var todo = await _client.PostJsonAsync("/api/v1/notes", new CreateNoteRequest("# List", Kind: NoteKind.Todo, DailyDate: Today));

        Assert.Equal(HttpStatusCode.BadRequest, todo.StatusCode);
        Assert.Contains("dailyDate", (await todo.Content.ReadFromJsonAsync<ValidationProblemDetails>(Ct))!.Errors.Keys);
        Assert.Equal(HttpStatusCode.BadRequest, (await _client.GetAsync("/api/v1/notes/daily/2026-13-40")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await _client.PostJsonAsync("/api/v1/notes", new { content = "x", dailyDate = "yesterday" })).StatusCode);
    }

    [Fact]
    public async Task End_to_end_daily_notes_keep_their_date()
    {
        var account = await EndToEndAccount.EnableAsync(_client);
        var id = Guid.CreateVersion7();

        await CreateAsync(new CreateNoteRequest(Id: id, Encrypted: account.EncryptNote(id, "# Tuesday\n\nprivate"), DailyDate: Today));

        var daily = await _client.GetJsonAsync<NoteResponse>("/api/v1/notes/daily/2026-09-29");
        Assert.Null(daily!.Content);
        Assert.Equal(("# Tuesday\n\nprivate", Today), (account.Decrypt(daily), daily.DailyDate));
    }

    private async Task<NoteResponse> CreateAsync(CreateNoteRequest request)
    {
        var response = await _client.PostJsonAsync("/api/v1/notes", request);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<NoteResponse>(ApiClient.Json, Ct))!;
    }
}
