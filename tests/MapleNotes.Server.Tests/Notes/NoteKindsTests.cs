using System.Net;
using System.Net.Http.Json;
using MapleNotes.Server.Domain;
using MapleNotes.Server.Features.Notes;
using MapleNotes.Server.Tests.TestSupport;

namespace MapleNotes.Server.Tests.Notes;

/// <summary>
/// Kinds of notes: todo lists and quick notes stay out of the timeline, lists and tag counts filter by kind, a note can
/// move between kinds, and end-to-end notes keep their kind.
/// </summary>
public sealed class NoteKindsTests : IAsyncLifetime
{
    private readonly MapleAppFactory _app = new();
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
    public async Task Todo_lists_and_quick_notes_stay_out_of_the_timeline()
    {
        var note = await CreateAsync(new CreateNoteRequest("A timeline note"));
        var todo = await CreateAsync(new CreateNoteRequest("# Groceries\n\n- [ ] oats", Kind: NoteKind.Todo));
        var pinnedTodo = await CreateAsync(new CreateNoteRequest("# Packing\n\n- [ ] tent", IsPinned: true, Kind: NoteKind.Todo));
        var quick = await CreateAsync(new CreateNoteRequest("Call the plumber", Kind: NoteKind.Quick));

        Assert.Equal((NoteKind.Todo, NoteKind.Quick), (todo.Kind, quick.Kind));
        Assert.Equal([note.Id], await IdsAsync("/api/v1/notes"));
        Assert.Equal([note.Id], await IdsAsync("/api/v1/notes?state=active"));
        Assert.Equal([todo.Id], await IdsAsync("/api/v1/notes?kind=todo"));
        Assert.Equal([pinnedTodo.Id], await IdsAsync("/api/v1/notes?state=pinned&kind=Todo"));
        Assert.Equal([quick.Id], await IdsAsync("/api/v1/notes?kind=quick"));
        Assert.Equal([quick.Id, pinnedTodo.Id, todo.Id, note.Id], await IdsAsync("/api/v1/notes?state=active&kind=note&kind=todo&kind=quick"));
        Assert.Equal(NoteKind.Todo, (await _client.GetJsonAsync<NoteResponse>($"/api/v1/notes/{todo.Id}"))!.Kind);
    }

    [Fact]
    public async Task Tags_searches_and_the_archive_cover_the_requested_kinds()
    {
        var note = await CreateAsync(new CreateNoteRequest("Maple syrup for pancakes #groceries"));
        var todo = await CreateAsync(new CreateNoteRequest("# Shop\n\n- [ ] maple syrup #groceries", Kind: NoteKind.Todo));
        await CreateAsync(new CreateNoteRequest("maple leaves #autumn", Kind: NoteKind.Quick));

        Assert.Equal([("autumn", 1), ("groceries", 2)], await TagCountsAsync("/api/v1/tags"));
        Assert.Equal([("groceries", 1)], await TagCountsAsync("/api/v1/tags?kind=note"));
        Assert.Equal([("groceries", 2)], await TagCountsAsync("/api/v1/tags?kind=note&kind=todo"));
        Assert.Equal([todo.Id, note.Id], await IdsAsync("/api/v1/notes?state=active&tag=groceries&kind=note&kind=todo"));
        Assert.Equal([todo.Id, note.Id], await IdsAsync("/api/v1/notes?state=active&q=maple%20syrup&kind=note&kind=todo&kind=quick"));

        (await _client.PatchJsonAsync($"/api/v1/notes/{todo.Id}", new PatchNoteRequest(IsArchived: true))).EnsureSuccessStatusCode();

        Assert.Equal([todo.Id], await IdsAsync("/api/v1/notes?state=archived&kind=note&kind=todo"));
        Assert.Empty(await IdsAsync("/api/v1/notes?state=archived"));
        Assert.Equal([("autumn", 1), ("groceries", 1)], await TagCountsAsync("/api/v1/tags"));
    }

    [Fact]
    public async Task A_quick_note_moves_to_the_timeline_and_back()
    {
        var quick = await CreateAsync(new CreateNoteRequest("Idea worth keeping", Kind: NoteKind.Quick));

        var moved = await PatchAsync(quick.Id, new PatchNoteRequest(Kind: NoteKind.Note));

        Assert.Equal(NoteKind.Note, moved.Kind);
        Assert.Equal(quick.UpdatedAtUtc, moved.UpdatedAtUtc); // moving is not editing
        Assert.Equal([quick.Id], await IdsAsync("/api/v1/notes"));
        Assert.Equal(NoteKind.Quick, (await PatchAsync(quick.Id, new PatchNoteRequest(Kind: NoteKind.Quick))).Kind);
        Assert.Empty(await IdsAsync("/api/v1/notes"));
    }

    [Fact]
    public async Task Unknown_kinds_are_rejected()
    {
        var note = await CreateAsync(new CreateNoteRequest("x"));

        Assert.Equal(HttpStatusCode.BadRequest, (await _client.GetAsync("/api/v1/notes?kind=diary")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await _client.GetAsync("/api/v1/notes?kind=7")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await _client.GetAsync("/api/v1/tags?kind=7")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await _client.PostJsonAsync("/api/v1/notes", new { content = "x", kind = 7 })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await _client.PostJsonAsync("/api/v1/notes", new { content = "x", kind = "Diary" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await _client.PatchJsonAsync($"/api/v1/notes/{note.Id}", new { kind = 9 })).StatusCode);
        Assert.Equal(NoteKind.Note, (await _client.GetJsonAsync<NoteResponse>($"/api/v1/notes/{note.Id}"))!.Kind);
    }

    [Fact]
    public async Task End_to_end_notes_keep_their_kind()
    {
        var account = await EndToEndAccount.EnableAsync(_client);
        var id = Guid.CreateVersion7();

        var todo = await CreateAsync(new CreateNoteRequest(Id: id, Encrypted: account.EncryptNote(id, "# Secret list\n\n- [ ] item"), Kind: NoteKind.Todo));

        Assert.Equal(NoteKind.Todo, todo.Kind);
        var listed = Assert.Single((await _client.GetJsonAsync<NotePageResponse>("/api/v1/notes?kind=todo"))!.Items);
        Assert.Null(listed.Content);
        Assert.Equal("# Secret list\n\n- [ ] item", account.Decrypt(listed));
        Assert.Empty(await IdsAsync("/api/v1/notes"));
    }

    private async Task<NoteResponse> CreateAsync(CreateNoteRequest request)
    {
        var response = await _client.PostJsonAsync("/api/v1/notes", request);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<NoteResponse>(ApiClient.Json, Ct))!;
    }

    private async Task<NoteResponse> PatchAsync(Guid id, PatchNoteRequest request)
    {
        var response = await _client.PatchJsonAsync($"/api/v1/notes/{id}", request);
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<NoteResponse>(ApiClient.Json, Ct))!;
    }

    private async Task<List<Guid>> IdsAsync(string url) =>
        (await _client.GetJsonAsync<NotePageResponse>(url))!.Items.Select(n => n.Id).ToList();

    private async Task<List<(string, int)>> TagCountsAsync(string url) =>
        (await _client.GetJsonAsync<List<TagResponse>>(url))!.Select(t => (t.Name!, t.NoteCount)).ToList();
}
