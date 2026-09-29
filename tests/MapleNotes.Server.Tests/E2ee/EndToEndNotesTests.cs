using System.Net;
using MapleNotes.Server.Domain;
using MapleNotes.Server.Features.Notes;
using MapleNotes.Server.Infrastructure.Persistence;
using MapleNotes.Server.Tests.TestSupport;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace MapleNotes.Server.Tests.E2ee;

/// <summary>
/// End-to-end encrypted notes and tags (docs/e2ee-spec.md §2, §4): the server stores ciphertext and blind tag tokens,
/// filters and counts by token, and never holds note text or tag names.
/// </summary>
public sealed class EndToEndNotesTests : IAsyncLifetime
{
    private const string SecretText = "Meet Zanzibar-7731 at the old mill #quokka #orchard/pruning";

    private readonly MapleAppFactory _app = new();
    private ApiClient _client = null!;
    private EndToEndAccount _account = null!;

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    public async ValueTask InitializeAsync()
    {
        _client = new ApiClient(_app);
        await _client.SignUpAsync("maple");
        _account = await EndToEndAccount.EnableAsync(_client);
    }

    public async ValueTask DisposeAsync()
    {
        _client.Dispose();
        await _app.DisposeAsync();
    }

    [Fact]
    public async Task Encrypted_notes_are_stored_and_returned_as_ciphertext()
    {
        var created = await CreateAsync(SecretText, pinned: true);

        var listed = Assert.Single((await _client.GetJsonAsync<NotePageResponse>("/api/v1/notes?state=pinned"))!.Items);
        Assert.Null(listed.Content);
        Assert.Empty(listed.Tags);
        Assert.Equal(created.Id, listed.Id);
        Assert.Equal(SecretText, _account.Decrypt(listed));
        using var scope = _app.Services.CreateScope();
        var stored = await scope.ServiceProvider.GetRequiredService<MapleDbContext>().Notes.SingleAsync(Ct);
        Assert.Equal(ContentScheme.EndToEnd, stored.Scheme);
    }

    [Fact]
    public async Task The_database_holds_no_note_text_and_no_tag_names()
    {
        await CreateAsync(SecretText);
        var note = await CreateAsync("A second thought about #quokka habitats");
        await UpdateAsync(note.Id, "Rewritten: Zanzibar-7731 again #orchard/pruning");

        var leaks = await DatabaseScanner.ScanAsync(_app, "Zanzibar-7731", "quokka", "orchard", "pruning", "habitats", "Rewritten");
        var control = await DatabaseScanner.ScanAsync(_app, "MAPLE"); // the normalized username is stored in plain text

        Assert.Empty(leaks);
        Assert.Contains("Users.NormalizedUsername contains \"MAPLE\"", control);
    }

    [Fact]
    public async Task Tags_are_counted_and_filtered_by_token_without_their_names()
    {
        var first = await CreateAsync(SecretText);
        var second = await CreateAsync("More about the #quokka");
        await CreateAsync("Untagged");

        var tags = (await _client.GetJsonAsync<List<TagResponse>>("/api/v1/tags"))!;
        var quokka = Assert.Single(tags, t => t.Token == _account.Token("quokka"));
        var byToken = await ListAsync($"?state=active&tagToken={_account.Token("quokka")}");
        var nested = await ListAsync($"?state=active&tagToken={_account.Token("orchard")}&tagToken={_account.Token("orchard/pruning")}");
        var unknown = await ListAsync($"?state=active&tagToken={_account.Token("nothing")}");

        Assert.All(tags, t => Assert.Null(t.Name));
        Assert.Equal(["orchard/pruning", "quokka"], tags.Select(_account.DecryptName).Order());
        Assert.Equal(2, quokka.NoteCount);
        Assert.Equal([first.Id, second.Id], byToken.Select(n => n.Id).Order());
        Assert.Equal(first.Id, Assert.Single(nested).Id);
        Assert.Empty(unknown);
    }

    [Fact]
    public async Task Editing_replaces_the_ciphertext_and_the_tags()
    {
        var note = await CreateAsync("First version #draft");

        var updated = await UpdateAsync(note.Id, "Final version #final");

        Assert.Equal("Final version #final", _account.Decrypt(updated));
        var tags = (await _client.GetJsonAsync<List<TagResponse>>("/api/v1/tags"))!;
        Assert.Equal("final", _account.DecryptName(Assert.Single(tags))); // the unused #draft token is gone
    }

    [Fact]
    public async Task Server_encrypted_notes_from_before_end_to_end_convert_when_saved_encrypted()
    {
        await using var app = new MapleAppFactory();
        using var client = new ApiClient(app);
        await client.SignUpAsync("mixed");
        var older = await EndToEndAccount.ReadAsync<NoteResponse>(
            await client.PostJsonAsync("/api/v1/notes", new CreateNoteRequest("Written before #old")));
        var account = await EndToEndAccount.EnableAsync(client);

        var search = await client.GetJsonAsync<NotePageResponse>("/api/v1/notes?state=active&q=before");
        var converted = await EndToEndAccount.ReadAsync<NoteResponse>(await client.PutJsonAsync(
            $"/api/v1/notes/{older.Id}", new UpdateNoteRequest(Encrypted: account.EncryptNote(older.Id, "Written before #old"))));

        Assert.Equal(older.Id, Assert.Single(search!.Items).Id); // the server still searches what it can read
        Assert.Equal("Written before #old", account.Decrypt(converted));
        var tag = Assert.Single((await client.GetJsonAsync<List<TagResponse>>("/api/v1/tags"))!);
        Assert.Null(tag.Name);
        Assert.Equal("old", account.DecryptName(tag));
        Assert.Empty((await client.GetJsonAsync<NotePageResponse>("/api/v1/notes?state=active&q=before"))!.Items);
    }

    [Fact]
    public async Task Encrypted_writes_are_checked_for_shape_and_client_ids()
    {
        var id = Guid.CreateVersion7();
        var good = _account.EncryptNote(id, "Hello #there");

        var noId = await _client.PostJsonAsync("/api/v1/notes", new CreateNoteRequest(Encrypted: good));
        var version4 = await _client.PostJsonAsync("/api/v1/notes", new CreateNoteRequest(Id: Guid.NewGuid(), Encrypted: good));
        var stale = await _client.PostJsonAsync("/api/v1/notes",
            new CreateNoteRequest(Id: Guid.CreateVersion7(DateTimeOffset.UtcNow.AddDays(-3)), Encrypted: good));
        var badEnvelope = await _client.PostJsonAsync("/api/v1/notes", new CreateNoteRequest(Id: id, Encrypted: good with { Content = new byte[10] }));
        var badToken = await _client.PostJsonAsync("/api/v1/notes",
            new CreateNoteRequest(Id: id, Encrypted: good with { Tags = [new EncryptedTag("not a token", good.Tags![0].Name)] }));
        var created = await _client.PostJsonAsync("/api/v1/notes", new CreateNoteRequest(Id: id, Encrypted: good));
        var duplicate = await _client.PostJsonAsync("/api/v1/notes", new CreateNoteRequest(Id: id, Encrypted: good));
        var badFilter = await _client.GetAsync("/api/v1/notes?tagToken=short");

        Assert.Contains("id", (await EndToEndAccount.ReadAsync<ValidationProblemDetails>(noId)).Errors.Keys);
        Assert.Contains("id", (await EndToEndAccount.ReadAsync<ValidationProblemDetails>(version4)).Errors.Keys);
        Assert.Contains("id", (await EndToEndAccount.ReadAsync<ValidationProblemDetails>(stale)).Errors.Keys);
        Assert.Contains("encrypted.content", (await EndToEndAccount.ReadAsync<ValidationProblemDetails>(badEnvelope)).Errors.Keys);
        Assert.Contains("encrypted.tags", (await EndToEndAccount.ReadAsync<ValidationProblemDetails>(badToken)).Errors.Keys);
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, duplicate.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, badFilter.StatusCode);
    }

    [Fact]
    public async Task Accounts_not_in_end_to_end_mode_cannot_send_ciphertext()
    {
        await using var app = new MapleAppFactory();
        using var client = new ApiClient(app);
        await client.SignUpAsync("plain");
        var id = Guid.CreateVersion7();

        var encrypted = await client.PostJsonAsync("/api/v1/notes", new CreateNoteRequest(Id: id, Encrypted: _account.EncryptNote(id, "x")));
        var ownId = await client.PostJsonAsync("/api/v1/notes", new CreateNoteRequest("plain text", Id: id));

        Assert.Equal(HttpStatusCode.Conflict, encrypted.StatusCode);
        Assert.Equal("This account does not use end-to-end encryption.", (await EndToEndAccount.ReadAsync<ProblemDetails>(encrypted)).Title);
        Assert.Contains("id", (await EndToEndAccount.ReadAsync<ValidationProblemDetails>(ownId)).Errors.Keys);
    }

    private async Task<NoteResponse> CreateAsync(string text, bool pinned = false)
    {
        var id = Guid.CreateVersion7();
        var response = await _client.PostJsonAsync("/api/v1/notes", new CreateNoteRequest(IsPinned: pinned, Id: id, Encrypted: _account.EncryptNote(id, text)));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return await EndToEndAccount.ReadAsync<NoteResponse>(response);
    }

    private async Task<NoteResponse> UpdateAsync(Guid id, string text)
    {
        var response = await _client.PutJsonAsync($"/api/v1/notes/{id}", new UpdateNoteRequest(Encrypted: _account.EncryptNote(id, text)));
        response.EnsureSuccessStatusCode();
        return await EndToEndAccount.ReadAsync<NoteResponse>(response);
    }

    private async Task<IReadOnlyList<NoteResponse>> ListAsync(string query) =>
        (await _client.GetJsonAsync<NotePageResponse>("/api/v1/notes" + query))!.Items;
}
