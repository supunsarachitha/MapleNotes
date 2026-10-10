using System.Net;
using System.Net.Http.Json;
using MapleNotes.Server.Domain;
using MapleNotes.Server.Features.Encryption;
using MapleNotes.Server.Features.Labels;
using MapleNotes.Server.Features.Notes;
using MapleNotes.Server.Infrastructure.Configuration;
using MapleNotes.Server.Infrastructure.Persistence;
using MapleNotes.Server.Tests.TestSupport;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace MapleNotes.Server.Tests.Labels;

/// <summary>Coloured labels: managing them, putting them on notes, listing a label's notes, and keeping them private.</summary>
public sealed class LabelsTests : IAsyncLifetime
{
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
    public async Task Labels_are_created_renamed_recoloured_and_deleted()
    {
        var work = await CreateAsync("  Work  ", "Blue");
        var home = await CreateAsync("Home");

        var renamed = await _client.PutJsonAsync($"/api/v1/labels/{work.Id}", new UpdateLabelRequest(Name: "Office", Color: "teal"));
        var deleted = await _client.DeleteAsync($"/api/v1/labels/{home.Id}");

        Assert.Equal(("Work", "Blue"), (work.Name, work.Color)); // trimmed
        Assert.Equal("Grey", home.Color);
        Assert.Equal(HttpStatusCode.OK, renamed.StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, deleted.StatusCode);
        var labels = await ListAsync();
        Assert.Equal([new LabelResponse(work.Id, "Office", null, "Teal", 0)], labels);
    }

    [Theory]
    [InlineData("", "Grey", "name")]
    [InlineData("   ", "Grey", "name")]
    [InlineData("A name that is far too long to fit on a label chip", "Grey", "name")]
    [InlineData("Work", "Magenta", "color")]
    public async Task Names_and_colours_are_checked(string name, string color, string field)
    {
        var response = await _client.PostJsonAsync("/api/v1/labels", new CreateLabelRequest(name, color));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains(field, (await response.Content.ReadFromJsonAsync<ValidationProblemDetails>(Ct))!.Errors.Keys);
        Assert.Empty(await ListAsync());
    }

    [Fact]
    public async Task Labels_go_on_notes_and_list_their_notes()
    {
        var work = await CreateAsync("Work", "Blue");
        var urgent = await CreateAsync("Urgent", "Red");
        var report = await CreateNoteAsync("Quarterly report");
        var lunch = await CreateNoteAsync("Lunch with the team");
        await CreateNoteAsync("Unlabelled");

        var labelled = await PatchAsync(report.Id, new PatchNoteRequest(LabelIds: [urgent.Id, work.Id, work.Id]));
        await PatchAsync(lunch.Id, new PatchNoteRequest(LabelIds: [work.Id]));

        Assert.Equal(new[] { urgent.Id, work.Id }.Order(), labelled.LabelIds!);
        Assert.Equal([lunch.Id, report.Id], await IdsAsync($"/api/v1/notes?state=active&label={work.Id}"));
        Assert.Equal([report.Id], await IdsAsync($"/api/v1/notes?state=active&label={urgent.Id}"));
        Assert.Equal([2, 1], (await ListAsync()).Select(l => l.NoteCount));

        var cleared = await PatchAsync(report.Id, new PatchNoteRequest(LabelIds: []));
        Assert.Empty(cleared.LabelIds!);
        Assert.Equal(report.Content, cleared.Content); // nothing else changed
    }

    [Fact]
    public async Task Counts_leave_out_archived_and_trashed_notes()
    {
        var work = await CreateAsync("Work");
        foreach (var (text, change) in new (string, PatchNoteRequest?)[]
                 {
                     ("active", null),
                     ("archived", new PatchNoteRequest(IsArchived: true)),
                     ("trashed", new PatchNoteRequest(IsTrashed: true)),
                 })
        {
            var note = await CreateNoteAsync(text);
            await PatchAsync(note.Id, new PatchNoteRequest(LabelIds: [work.Id]));
            if (change is not null)
            {
                await PatchAsync(note.Id, change);
            }
        }

        Assert.Equal(1, (await ListAsync()).Single().NoteCount);
        Assert.Single(await IdsAsync($"/api/v1/notes?state=archived&label={work.Id}"));
    }

    [Fact]
    public async Task Deleting_a_label_takes_it_off_its_notes()
    {
        var work = await CreateAsync("Work");
        var note = await CreateNoteAsync("Labelled");
        await PatchAsync(note.Id, new PatchNoteRequest(LabelIds: [work.Id]));

        (await _client.DeleteAsync($"/api/v1/labels/{work.Id}")).EnsureSuccessStatusCode();

        var after = (await _client.GetJsonAsync<NoteResponse>($"/api/v1/notes/{note.Id}"))!;
        Assert.Empty(after.LabelIds!);
        Assert.Equal("Labelled", after.Content);
    }

    [Fact]
    public async Task A_note_carries_at_most_20_labels()
    {
        var labels = new List<Guid>();
        for (var i = 0; i < Label.MaxPerNote + 1; i++)
        {
            labels.Add((await CreateAsync($"label {i}")).Id);
        }

        var note = await CreateNoteAsync("Busy");
        var response = await _client.PatchJsonAsync($"/api/v1/notes/{note.Id}", new PatchNoteRequest(LabelIds: labels));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("labelIds", (await response.Content.ReadFromJsonAsync<ValidationProblemDetails>(Ct))!.Errors.Keys);
    }

    [Fact]
    public async Task An_account_has_at_most_100_labels()
    {
        using (var scope = _app.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<MapleDbContext>();
            var userId = (await db.Users.SingleAsync(Ct)).Id;
            db.Labels.AddRange(Enumerable.Range(0, Label.MaxPerAccount).Select(i => new Label { UserId = userId, Name = $"label {i}" }));
            await db.SaveChangesAsync(Ct);
        }

        var response = await _client.PostJsonAsync("/api/v1/labels", new CreateLabelRequest("One more"));

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
    }

    [Fact]
    public async Task Labels_are_private_to_their_account()
    {
        using var other = new ApiClient(_app);
        await other.SignUpAsync("other");
        var theirs = await EndToEndAccount.ReadAsync<LabelResponse>(await other.PostJsonAsync("/api/v1/labels", new CreateLabelRequest("Secret")));
        var note = await CreateNoteAsync("Mine");

        var useTheirs = await _client.PatchJsonAsync($"/api/v1/notes/{note.Id}", new PatchNoteRequest(LabelIds: [theirs.Id]));
        var renameTheirs = await _client.PutJsonAsync($"/api/v1/labels/{theirs.Id}", new UpdateLabelRequest(Name: "Mine now"));
        var deleteTheirs = await _client.DeleteAsync($"/api/v1/labels/{theirs.Id}");

        Assert.Equal(HttpStatusCode.BadRequest, useTheirs.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, renameTheirs.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, deleteTheirs.StatusCode);
        Assert.Empty(await ListAsync());
        Assert.Equal("Secret", (await other.GetJsonAsync<List<LabelResponse>>("/api/v1/labels"))!.Single().Name);
    }

    [Fact]
    public async Task A_plain_account_sends_plain_names_and_no_ids()
    {
        var encrypted = await _client.PostJsonAsync("/api/v1/labels", new CreateLabelRequest(EncryptedName: new byte[40]));
        var withId = await _client.PostJsonAsync("/api/v1/labels", new CreateLabelRequest("Work", Id: Guid.CreateVersion7()));

        Assert.Equal(HttpStatusCode.Conflict, encrypted.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, withId.StatusCode);
    }

    [Fact]
    public async Task End_to_end_label_names_are_encrypted_by_the_browser()
    {
        var account = await EndToEndAccount.EnableAsync(_client);
        var id = Guid.CreateVersion7();

        var plain = await _client.PostJsonAsync("/api/v1/labels", new CreateLabelRequest("Zanzibar trip"));
        var withoutId = await _client.PostJsonAsync("/api/v1/labels", new CreateLabelRequest(EncryptedName: account.EncryptLabelName(id, "Zanzibar trip")));
        var created = await _client.PostJsonAsync(
            "/api/v1/labels", new CreateLabelRequest(Color: "Green", Id: id, EncryptedName: account.EncryptLabelName(id, "Zanzibar trip")));

        Assert.Equal(HttpStatusCode.Conflict, plain.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, withoutId.StatusCode);
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var label = (await ListAsync()).Single();
        Assert.Equal((id, null, "Green"), (label.Id, label.Name, label.Color));
        Assert.Equal("Zanzibar trip", account.DecryptLabelName(id, label.EncryptedName!));
        Assert.Empty(await DatabaseScanner.ScanAsync(_app, "Zanzibar"));
    }

    [Fact]
    public async Task Label_names_convert_with_the_account_and_keep_the_key_until_they_have()
    {
        await using var app = new MapleAppFactory { RunEncryptionWorker = false };
        using var client = new ApiClient(app);
        await client.SignUpAsync("converts");
        var label = await EndToEndAccount.ReadAsync<LabelResponse>(await client.PostJsonAsync("/api/v1/labels", new CreateLabelRequest("Quokka plans", "Pink")));

        // Into end-to-end encryption: the label is the only item, so it is all the browser converts.
        var account = await EndToEndAccount.EnableAsync(client);
        var entering = await client.GetJsonAsync<EncryptionStatusResponse>("/api/v1/account/encryption");
        Assert.Equal(1, await new BrowserConverter(client, account).RunAsync());
        Assert.Equal((true, 1), (entering!.InProgress, entering.RemainingItems));
        var encrypted = (await client.GetJsonAsync<List<LabelResponse>>("/api/v1/labels"))!.Single();
        Assert.Null(encrypted.Name);
        Assert.Equal("Quokka plans", account.DecryptLabelName(label.Id, encrypted.EncryptedName!));
        Assert.Empty(await DatabaseScanner.ScanAsync(app, "Quokka"));

        // And out again: the end-to-end key stays while the label's name still needs it.
        (await account.SetModeAsync(client, EncryptionMode.AtRest)).EnsureSuccessStatusCode();
        Assert.NotNull((await StoredUserAsync(app)).E2eeWrappedKey);
        Assert.Equal(1, await new BrowserConverter(client, account).RunAsync());
        var plain = (await client.GetJsonAsync<List<LabelResponse>>("/api/v1/labels"))!.Single();
        Assert.Equal(("Quokka plans", "Pink"), (plain.Name, plain.Color));
        Assert.Null((await StoredUserAsync(app)).E2eeWrappedKey);
    }

    [Fact]
    public async Task Deleting_all_content_deletes_the_labels_too()
    {
        await CreateAsync("Work");

        var response = await _client.Http.SendAsync(
            new HttpRequestMessage(HttpMethod.Delete, "/api/v1/account/content") { Content = JsonContent.Create(new { proof = await _client.ProofAsync() }, options: ApiClient.Json) },
            Ct);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Empty(await ListAsync());
    }

    [Fact]
    public async Task A_label_can_hide_its_notes_from_home_and_quick_notes_but_not_from_its_own_page()
    {
        await LabelsOnAsync(true);
        var hidden = await CreateAsync("Private");
        (await _client.PutJsonAsync($"/api/v1/labels/{hidden.Id}", new UpdateLabelRequest(HideNotes: true))).EnsureSuccessStatusCode();
        var other = await CreateAsync("Work");
        var secret = await CreateNoteAsync("Surprise party plans");
        var plain = await CreateNoteAsync("Groceries");
        var pinned = await CreateNoteAsync("Gift list");
        var quick = await CreateNoteAsync("Call the florist", NoteKind.Quick);
        var todo = await CreateNoteAsync("# Party\n\n- [ ] cake", NoteKind.Todo);
        await PatchAsync(secret.Id, new PatchNoteRequest(LabelIds: [hidden.Id, other.Id]));
        await PatchAsync(pinned.Id, new PatchNoteRequest(IsPinned: true, LabelIds: [hidden.Id]));
        await PatchAsync(quick.Id, new PatchNoteRequest(LabelIds: [hidden.Id]));
        await PatchAsync(todo.Id, new PatchNoteRequest(LabelIds: [hidden.Id]));

        Assert.Equal([plain.Id], await IdsAsync("/api/v1/notes?state=feed"));
        Assert.Empty(await IdsAsync("/api/v1/notes?state=pinned"));
        Assert.Empty(await IdsAsync("/api/v1/notes?state=feed&kind=quick"));
        Assert.Equal([todo.Id], await IdsAsync("/api/v1/notes?state=feed&kind=todo")); // todo lists keep their tab
        Assert.Equal([secret.Id], await IdsAsync($"/api/v1/notes?state=active&label={other.Id}"));
        Assert.Equal(
            [quick.Id, pinned.Id, secret.Id],
            await IdsAsync($"/api/v1/notes?state=active&kind=note&kind=quick&label={hidden.Id}")); // the label's page
        Assert.Equal([secret.Id], await IdsAsync("/api/v1/notes?state=active&q=party%20plans")); // search still finds it
        Assert.True((await ListAsync()).Single(l => l.Id == hidden.Id).HideNotes);

        // Taking the label off a note brings it back; so does turning the option off, or labels altogether.
        await PatchAsync(secret.Id, new PatchNoteRequest(LabelIds: [other.Id]));
        Assert.Equal([plain.Id, secret.Id], await IdsAsync("/api/v1/notes?state=feed"));
        (await _client.PutJsonAsync($"/api/v1/labels/{hidden.Id}", new UpdateLabelRequest(HideNotes: false))).EnsureSuccessStatusCode();
        Assert.Equal([quick.Id], await IdsAsync("/api/v1/notes?state=feed&kind=quick"));
        (await _client.PutJsonAsync($"/api/v1/labels/{hidden.Id}", new UpdateLabelRequest(HideNotes: true))).EnsureSuccessStatusCode();
        await LabelsOnAsync(false);
        Assert.Equal([pinned.Id], await IdsAsync("/api/v1/notes?state=pinned"));
    }

    private async Task LabelsOnAsync(bool on) =>
        (await _client.PutJsonAsync("/api/v1/account/preferences", new UserPreferences { Labels = on })).EnsureSuccessStatusCode();

    private async Task<LabelResponse> CreateAsync(string name, string? color = null)
    {
        var response = await _client.PostJsonAsync("/api/v1/labels", new CreateLabelRequest(name, color));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<LabelResponse>(ApiClient.Json, Ct))!;
    }

    private async Task<List<LabelResponse>> ListAsync() => (await _client.GetJsonAsync<List<LabelResponse>>("/api/v1/labels"))!;

    private async Task<NoteResponse> CreateNoteAsync(string content, NoteKind kind = NoteKind.Note)
    {
        var response = await _client.PostJsonAsync("/api/v1/notes", new CreateNoteRequest(content, Kind: kind));
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

    private static async Task<User> StoredUserAsync(MapleAppFactory app)
    {
        using var scope = app.Services.CreateScope();
        return await scope.ServiceProvider.GetRequiredService<MapleDbContext>().Users.AsNoTracking().SingleAsync(Ct);
    }
}
