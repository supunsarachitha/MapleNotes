using System.Net;
using System.Net.Http.Json;
using System.Text;
using MapleNotes.Server.Domain;
using MapleNotes.Server.Features.Notes;
using MapleNotes.Server.Infrastructure.Configuration;
using MapleNotes.Server.Infrastructure.Persistence;
using MapleNotes.Server.Tests.TestSupport;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace MapleNotes.Server.Tests.Notes;

public sealed class NotesApiTests : IAsyncLifetime
{
    private readonly MapleAppFactory _app = new() { Settings = { [MapleOptions.AllowRegistrationKey] = "true" } };
    private ApiClient _client = null!;

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    public async ValueTask InitializeAsync()
    {
        _client = new ApiClient(_app);
        await _client.SignUpAsync("maple");
    }

    [Fact]
    public async Task Created_note_round_trips_and_is_encrypted_at_rest()
    {
        var created = await CreateAsync("Buy **maple syrup** #groceries");

        var fetched = await _client.GetJsonAsync<NoteResponse>($"/api/v1/notes/{created.Id}");

        Assert.Equal("Buy **maple syrup** #groceries", fetched!.Content);
        Assert.Equal(["groceries"], fetched.Tags);
        var stored = await StoredNoteAsync(created.Id);
        Assert.Equal(ContentScheme.Server, stored.Scheme);
        Assert.DoesNotContain("maple syrup", Encoding.UTF8.GetString(stored.Content), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Accounts_without_encryption_store_plain_text()
    {
        await using var app = new MapleAppFactory { Settings = { [MapleOptions.DefaultEncryptionKey] = "false" } };
        using var client = new ApiClient(app);
        await client.SignUpAsync("plain");

        var response = await client.PostJsonAsync("/api/v1/notes", new CreateNoteRequest("readable"));
        var note = await response.Content.ReadFromJsonAsync<NoteResponse>(ApiClient.Json, Ct);

        using var scope = app.Services.CreateScope();
        var stored = await scope.ServiceProvider.GetRequiredService<MapleDbContext>().Notes.SingleAsync(n => n.Id == note!.Id, Ct);
        Assert.Equal(ContentScheme.None, stored.Scheme);
        Assert.Equal("readable", Encoding.UTF8.GetString(stored.Content));
    }

    [Fact]
    public async Task Feed_pages_newest_first_without_gaps_or_duplicates()
    {
        for (var i = 0; i < 45; i++)
        {
            await CreateAsync($"note {i}");
        }

        var first = await ListAsync("/api/v1/notes?limit=20");
        await CreateAsync("posted while scrolling"); // must not shift the following pages
        var second = await ListAsync($"/api/v1/notes?limit=20&cursor={first.NextCursor}");
        var third = await ListAsync($"/api/v1/notes?limit=20&cursor={second.NextCursor}");

        var contents = first.Items.Concat(second.Items).Concat(third.Items).Select(n => n.Content).ToList();
        Assert.Equal(Enumerable.Range(0, 45).Reverse().Select(i => $"note {i}"), contents);
        Assert.Null(third.NextCursor);
    }

    [Fact]
    public async Task Pinned_notes_are_listed_separately_from_the_feed()
    {
        var pinned = await CreateAsync("important", pinned: true);
        var regular = await CreateAsync("regular");

        var feed = await ListAsync("/api/v1/notes");
        var pins = await ListAsync("/api/v1/notes?state=pinned");
        var active = await ListAsync("/api/v1/notes?state=active");

        Assert.Equal([regular.Id], feed.Items.Select(n => n.Id));
        Assert.Equal([pinned.Id], pins.Items.Select(n => n.Id));
        Assert.Equal([regular.Id, pinned.Id], active.Items.Select(n => n.Id));
    }

    [Fact]
    public async Task Archiving_hides_a_note_and_restoring_brings_it_back()
    {
        var note = await CreateAsync("old idea");

        var archived = await PatchAsync(note.Id, new PatchNoteRequest(IsArchived: true));
        var feedWhileArchived = await ListAsync("/api/v1/notes");
        var archive = await ListAsync("/api/v1/notes?state=archived");
        await PatchAsync(note.Id, new PatchNoteRequest(IsArchived: false));
        var feedAfterRestore = await ListAsync("/api/v1/notes");

        Assert.True(archived.IsArchived);
        Assert.Empty(feedWhileArchived.Items);
        Assert.Equal([note.Id], archive.Items.Select(n => n.Id));
        Assert.Equal([note.Id], feedAfterRestore.Items.Select(n => n.Id));
    }

    [Fact]
    public async Task Editing_updates_text_and_tags()
    {
        var note = await CreateAsync("draft #todo");

        var response = await _client.PutJsonAsync($"/api/v1/notes/{note.Id}", new UpdateNoteRequest("final #done #work/meetings"));
        var updated = await response.Content.ReadFromJsonAsync<NoteResponse>(ApiClient.Json, Ct);
        var tags = await _client.GetJsonAsync<List<TagResponse>>("/api/v1/tags");

        Assert.Equal("final #done #work/meetings", updated!.Content);
        Assert.Equal(["done", "work/meetings"], updated.Tags);
        Assert.True(updated.UpdatedAtUtc > note.UpdatedAtUtc);
        Assert.Equal(["done", "work/meetings"], tags!.Select(t => t.Name)); // "todo" is gone
    }

    [Fact]
    public async Task Editing_the_version_the_client_saw_succeeds()
    {
        var note = await CreateAsync("first");

        var response = await _client.PutJsonAsync(
            $"/api/v1/notes/{note.Id}", new UpdateNoteRequest("second", ExpectedUpdatedAtUtc: note.UpdatedAtUtc));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("second", (await _client.GetJsonAsync<NoteResponse>($"/api/v1/notes/{note.Id}"))!.Content);
    }

    [Fact]
    public async Task Editing_an_older_version_is_refused_and_keeps_the_newer_text()
    {
        var note = await CreateAsync("first");
        await _client.PutJsonAsync($"/api/v1/notes/{note.Id}", new UpdateNoteRequest("edited on another device"));

        var response = await _client.PutJsonAsync(
            $"/api/v1/notes/{note.Id}", new UpdateNoteRequest("edited offline", ExpectedUpdatedAtUtc: note.UpdatedAtUtc));

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Equal("edited on another device", (await _client.GetJsonAsync<NoteResponse>($"/api/v1/notes/{note.Id}"))!.Content);
    }

    [Fact]
    public async Task The_expected_version_compares_the_instant_whatever_its_offset()
    {
        var note = await CreateAsync("first");
        var sameInstant = note.UpdatedAtUtc.ToString("yyyy-MM-ddTHH:mm:ss.fffffff") + "+00:00";

        var response = await _client.PutJsonAsync(
            $"/api/v1/notes/{note.Id}", new { content = "second", expectedUpdatedAtUtc = sameInstant });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Tag_filter_includes_nested_tags()
    {
        var parent = await CreateAsync("#work planning");
        var child = await CreateAsync("#work/meetings standup");
        await CreateAsync("#home chores");

        var work = await ListAsync("/api/v1/notes?state=active&tag=work");

        Assert.Equal([child.Id, parent.Id], work.Items.Select(n => n.Id));
    }

    [Fact]
    public async Task Search_finds_text_inside_encrypted_notes_case_insensitively()
    {
        await CreateAsync("Recipe: Maple Glazed Salmon");
        await CreateAsync("Shopping list");
        await CreateAsync("maple syrup grades");

        var results = await ListAsync("/api/v1/notes?state=active&q=MAPLE");

        Assert.Equal(["maple syrup grades", "Recipe: Maple Glazed Salmon"], results.Items.Select(n => n.Content));
    }

    [Fact]
    public async Task Search_results_page_with_cursors()
    {
        for (var i = 0; i < 7; i++)
        {
            await CreateAsync($"match {i}");
            await CreateAsync($"other {i}");
        }

        var first = await ListAsync("/api/v1/notes?state=active&q=match&limit=5");
        var second = await ListAsync($"/api/v1/notes?state=active&q=match&limit=5&cursor={first.NextCursor}");

        Assert.Equal(["match 6", "match 5", "match 4", "match 3", "match 2"], first.Items.Select(n => n.Content));
        Assert.Equal(["match 1", "match 0"], second.Items.Select(n => n.Content));
        Assert.Null(second.NextCursor);
    }

    [Fact]
    public async Task Deleting_a_note_removes_it_permanently()
    {
        var note = await CreateAsync("temporary #scratch");

        var delete = await _client.DeleteAsync($"/api/v1/notes/{note.Id}");

        Assert.Equal(HttpStatusCode.NoContent, delete.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await _client.GetAsync($"/api/v1/notes/{note.Id}")).StatusCode);
        Assert.Empty((await _client.GetJsonAsync<List<TagResponse>>("/api/v1/tags"))!);
    }

    [Fact]
    public async Task Other_users_cannot_see_or_change_a_note()
    {
        var note = await CreateAsync("private");
        using var intruder = new ApiClient(_app);
        await intruder.SignUpAsync("intruder");

        Assert.Equal(HttpStatusCode.NotFound, (await intruder.GetAsync($"/api/v1/notes/{note.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await intruder.PutJsonAsync($"/api/v1/notes/{note.Id}", new UpdateNoteRequest("hacked"))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await intruder.PatchJsonAsync($"/api/v1/notes/{note.Id}", new PatchNoteRequest(IsArchived: true))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await intruder.DeleteAsync($"/api/v1/notes/{note.Id}")).StatusCode);
        Assert.Empty((await intruder.GetJsonAsync<NotePageResponse>("/api/v1/notes?state=active"))!.Items);
        Assert.Equal("private", (await _client.GetJsonAsync<NoteResponse>($"/api/v1/notes/{note.Id}"))!.Content);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public async Task Empty_notes_are_rejected(string content)
    {
        var response = await _client.PostJsonAsync("/api/v1/notes", new CreateNoteRequest(content));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("content", (await response.Content.ReadFromJsonAsync<ValidationProblemDetails>(ApiClient.Json, Ct))!.Errors.Keys);
    }

    [Fact]
    public async Task Overlong_notes_are_rejected()
    {
        var response = await _client.PostJsonAsync("/api/v1/notes", new CreateNoteRequest(new string('x', NoteService.MaxContentLength + 1)));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Invalid_cursor_is_rejected()
    {
        var response = await _client.GetAsync("/api/v1/notes?cursor=not-a-cursor");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("cursor", (await response.Content.ReadFromJsonAsync<ValidationProblemDetails>(ApiClient.Json, Ct))!.Errors.Keys);
    }

    public async ValueTask DisposeAsync()
    {
        _client.Dispose();
        await _app.DisposeAsync();
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
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<NoteResponse>(ApiClient.Json, Ct))!;
    }

    private async Task<NotePageResponse> ListAsync(string url) => (await _client.GetJsonAsync<NotePageResponse>(url))!;

    private async Task<Domain.Note> StoredNoteAsync(Guid id)
    {
        using var scope = _app.Services.CreateScope();
        return await scope.ServiceProvider.GetRequiredService<MapleDbContext>().Notes.AsNoTracking().SingleAsync(n => n.Id == id, Ct);
    }
}
