using System.Net;
using System.Text;
using MapleNotes.Server.Domain;
using MapleNotes.Server.Features.Attachments;
using MapleNotes.Server.Features.Auth;
using MapleNotes.Server.Features.Encryption;
using MapleNotes.Server.Features.EndToEnd;
using MapleNotes.Server.Features.Notes;
using MapleNotes.Server.Infrastructure.Persistence;
using MapleNotes.Server.Tests.TestSupport;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace MapleNotes.Server.Tests.E2ee;

/// <summary>
/// Changing to and from end-to-end encryption with existing content: the browser converts it item by item, the
/// conversion resumes after an interruption in either direction, never overwrites an edit, and keys are deleted once
/// nothing needs them (the server keeps no content key once an account is fully end-to-end).
/// </summary>
public sealed class ConversionTests : IAsyncLifetime
{
    private readonly MapleAppFactory _app = new() { RunEncryptionWorker = false };
    private ApiClient _client = null!;
    private Dictionary<Guid, (string Text, DateTime UpdatedAtUtc)> _notes = [];
    private Dictionary<Guid, byte[]> _files = [];

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    public async ValueTask InitializeAsync()
    {
        _client = new ApiClient(_app);
        await _client.SignUpAsync("maple"); // encryption at rest is on by default: notes and files are server-encrypted

        var photo = Encoding.UTF8.GetBytes(new string('p', 70_000) + " photo of the Zanzibar harbour");
        var upload = await EndToEndAccount.ReadAsync<AttachmentResponse>(await _client.UploadAsync(photo, "zanzibar-harbour.png", "image/png"));
        _files[upload.Id] = photo;
        await NoteAsync("Dinner at Zanzibar with #friends", [upload.Id]);
        await NoteAsync("Quarterly plan for the #orchard");
        await NoteAsync("Untagged thought about quokkas");
    }

    public async ValueTask DisposeAsync()
    {
        _client.Dispose();
        await _app.DisposeAsync();
    }

    [Fact]
    public async Task Entering_end_to_end_converts_everything_and_the_server_keeps_no_content_key()
    {
        var urlBefore = await PhotoUrlAsync();
        var account = await EndToEndAccount.EnableAsync(_client);
        var before = await StatusAsync();

        var converted = await new BrowserConverter(_client, account).RunAsync();

        Assert.Equal(new EncryptionStatusResponse(EncryptionMode.EndToEnd, true, 4, 4), before);
        Assert.Equal(4, converted);
        Assert.Equal(new EncryptionStatusResponse(EncryptionMode.EndToEnd, false, 4, 0), await StatusAsync());
        var user = await StoredUserAsync();
        Assert.Null(user.WrappedDataKey); // the server holds no key to any of this account's content
        Assert.NotNull(user.E2eeWrappedKey);
        Assert.Empty(await DatabaseScanner.ScanAsync(_app, "Zanzibar", "friends", "orchard", "quokkas", "zanzibar-harbour"));
        await AssertReadableAsync(account);
        Assert.NotEqual(urlBefore, await PhotoUrlAsync()); // new bytes, new URL: a cached plain copy is never reused
    }

    private async Task<string> PhotoUrlAsync() =>
        (await _client.GetJsonAsync<NotePageResponse>("/api/v1/notes?state=active"))!.Items.SelectMany(n => n.Attachments).Single().Url;

    [Fact]
    public async Task An_interrupted_conversion_resumes_in_both_directions_and_can_switch_back_midway()
    {
        var account = await EndToEndAccount.EnableAsync(_client);

        Assert.Equal(2, await new BrowserConverter(_client, account).RunAsync(maxItems: 2)); // the tab closes
        using var laptop = new ApiClient(_app);
        await laptop.LoginAsync("maple");
        Assert.Equal(2, await new BrowserConverter(laptop, account).RunAsync()); // another session picks up
        Assert.Null((await StoredUserAsync()).WrappedDataKey);

        // Leave for encryption at rest, stop half-way, change one's mind, and go back.
        (await laptop.PutJsonAsync("/api/v1/account/encryption", new UpdateEncryptionRequest(EncryptionMode.AtRest, await laptop.ProofAsync()))).EnsureSuccessStatusCode();
        Assert.NotNull((await StoredUserAsync()).WrappedDataKey); // a new server key for the notes it will hold again
        Assert.Equal(2, await new BrowserConverter(laptop, account).RunAsync(maxItems: 2));
        var back = await laptop.PutJsonAsync("/api/v1/account/encryption", new UpdateEncryptionRequest(EncryptionMode.EndToEnd, await laptop.ProofAsync()));
        Assert.Equal(HttpStatusCode.OK, back.StatusCode); // the existing key is reused: no new recovery key
        Assert.Equal(2, await new BrowserConverter(laptop, account).RunAsync());
        Assert.Equal(0, (await StatusAsync()).RemainingItems);
        Assert.Null((await StoredUserAsync()).WrappedDataKey);
        await AssertReadableAsync(account);

        // Leave for good: once the last item is decrypted, the end-to-end key material is gone.
        (await laptop.PutJsonAsync("/api/v1/account/encryption", new UpdateEncryptionRequest(EncryptionMode.Off, await laptop.ProofAsync()))).EnsureSuccessStatusCode();
        Assert.True((await laptop.GetJsonAsync<UserResponse>("/api/v1/auth/me"))!.HasEndToEndKey); // still needed
        Assert.Equal(4, await new BrowserConverter(laptop, account).RunAsync());
        var user = await StoredUserAsync();
        Assert.Equal((EncryptionMode.Off, null, null, null), (user.EncryptionMode, user.E2eeWrappedKey, user.E2eeRecoveryWrappedKey, user.RecoveryKeyHash));
        Assert.False((await laptop.GetJsonAsync<UserResponse>("/api/v1/auth/me"))!.HasEndToEndKey);
        await AssertPlainAsync(laptop);
    }

    [Fact]
    public async Task A_conversion_never_overwrites_an_edit_and_keeps_timestamps()
    {
        var account = await EndToEndAccount.EnableAsync(_client);
        var batch = (await _client.GetJsonAsync<ConversionBatchResponse>("/api/v1/account/conversion?limit=50"))!;
        var edited = batch.Notes[0];

        // The note is edited (and so encrypted) in another tab before the converter gets to it.
        (await _client.PutJsonAsync($"/api/v1/notes/{edited.Id}", new UpdateNoteRequest(Encrypted: account.EncryptNote(edited.Id, "Edited meanwhile")))).EnsureSuccessStatusCode();
        var stale = await _client.PutJsonAsync($"/api/v1/account/conversion/notes/{edited.Id}",
            new ConvertNoteRequest(edited.UpdatedAtUtc, Encrypted: account.EncryptNote(edited.Id, edited.Content!)));
        var other = batch.Notes[1];
        var wrongVersion = await _client.PutJsonAsync($"/api/v1/account/conversion/notes/{other.Id}",
            new ConvertNoteRequest(other.UpdatedAtUtc.AddTicks(1), Encrypted: account.EncryptNote(other.Id, other.Content!)));
        await new BrowserConverter(_client, account).RunAsync();

        Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, wrongVersion.StatusCode);
        var notes = (await _client.GetJsonAsync<NotePageResponse>("/api/v1/notes?state=active"))!.Items;
        Assert.Equal("Edited meanwhile", account.Decrypt(notes.Single(n => n.Id == edited.Id)));
        var untouched = notes.Single(n => n.Id == other.Id);
        Assert.Equal(_notes[other.Id].UpdatedAtUtc, untouched.UpdatedAtUtc); // converting is not editing
    }

    [Fact]
    public async Task A_conversion_cannot_store_more_than_the_note()
    {
        var account = await EndToEndAccount.EnableAsync(_client);
        var (id, (text, updated)) = _notes.First();

        var padded = await _client.PutJsonAsync($"/api/v1/account/conversion/notes/{id}",
            new ConvertNoteRequest(updated, Encrypted: account.EncryptNote(id, text + new string(' ', 300_000))));
        var exact = await _client.PutJsonAsync($"/api/v1/account/conversion/notes/{id}",
            new ConvertNoteRequest(updated, Encrypted: account.EncryptNote(id, text)));

        // A conversion is not counted against the storage limit, so it may not grow the note.
        Assert.Equal(HttpStatusCode.BadRequest, padded.StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, exact.StatusCode);
    }

    [Fact]
    public async Task Conversion_requests_must_match_the_direction()
    {
        var account = await EndToEndAccount.EnableAsync(_client);
        var note = _notes.Keys.First();
        var file = _files.Keys.Single();

        var plain = await _client.PutJsonAsync($"/api/v1/account/conversion/notes/{note}", new ConvertNoteRequest(_notes[note].UpdatedAtUtc, Content: "x"));
        var missing = await _client.PutJsonAsync($"/api/v1/account/conversion/notes/{Guid.CreateVersion7()}", new ConvertNoteRequest(DateTime.UtcNow, Content: "x"));
        var plainFile = await _client.PutFileAsync($"/api/v1/account/conversion/attachments/{file}", [1, 2, 3], "a.png", "image/png");
        await new BrowserConverter(_client, account).RunAsync();
        var again = await _client.PutJsonAsync($"/api/v1/account/conversion/notes/{note}",
            new ConvertNoteRequest(_notes[note].UpdatedAtUtc, Encrypted: account.EncryptNote(note, "again")));

        Assert.Contains("encrypted", (await EndToEndAccount.ReadAsync<ValidationProblemDetails>(plain)).Errors.Keys);
        Assert.Equal(HttpStatusCode.NotFound, missing.StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, plainFile.StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, again.StatusCode);
        Assert.Empty((await _client.GetJsonAsync<ConversionBatchResponse>("/api/v1/account/conversion"))!.Notes);
    }

    [Fact]
    public async Task Switching_back_to_end_to_end_needs_the_existing_key()
    {
        var toEndToEnd = await _client.PutJsonAsync("/api/v1/account/encryption",
            new UpdateEncryptionRequest(EncryptionMode.EndToEnd, await _client.ProofAsync()));

        Assert.Contains("mode", (await EndToEndAccount.ReadAsync<ValidationProblemDetails>(toEndToEnd)).Errors.Keys);
    }

    private async Task NoteAsync(string text, IReadOnlyList<Guid>? attachments = null)
    {
        var note = await EndToEndAccount.ReadAsync<NoteResponse>(await _client.PostJsonAsync("/api/v1/notes", new CreateNoteRequest(text, attachments)));
        _notes[note.Id] = (text, note.UpdatedAtUtc);
    }

    private async Task<EncryptionStatusResponse> StatusAsync() =>
        (await _client.GetJsonAsync<EncryptionStatusResponse>("/api/v1/account/encryption"))!;

    private async Task<User> StoredUserAsync()
    {
        using var scope = _app.Services.CreateScope();
        return await scope.ServiceProvider.GetRequiredService<MapleDbContext>().Users.AsNoTracking().SingleAsync(Ct);
    }

    /// <summary>Every note and file decrypts to what was written before the change.</summary>
    private async Task AssertReadableAsync(EndToEndAccount account)
    {
        var notes = (await _client.GetJsonAsync<NotePageResponse>("/api/v1/notes?state=active"))!.Items;
        Assert.Equal(_notes.Keys.Order(), notes.Select(n => n.Id).Order());
        Assert.All(notes, note => Assert.Equal(_notes[note.Id].Text, account.Decrypt(note)));
        foreach (var (id, bytes) in _files)
        {
            var stored = await (await _client.GetAsync($"/api/v1/attachments/{id}")).Content.ReadAsByteArrayAsync(Ct);
            Assert.Equal(bytes, account.DecryptFile(id, stored));
        }
    }

    /// <summary>Every note and file is readable by the server again, with its name and tags.</summary>
    private async Task AssertPlainAsync(ApiClient client)
    {
        var notes = (await client.GetJsonAsync<NotePageResponse>("/api/v1/notes?state=active"))!.Items;
        Assert.All(notes, note => Assert.Equal(_notes[note.Id].Text, note.Content));
        Assert.Equal(["friends", "orchard"], (await client.GetJsonAsync<List<TagResponse>>("/api/v1/tags"))!.Select(t => t.Name));
        var file = Assert.Single(notes.SelectMany(n => n.Attachments));
        Assert.Equal(("zanzibar-harbour.png", "image/png"), (file.FileName, file.ContentType));
        Assert.Equal(_files[file.Id], await (await client.GetAsync($"/api/v1/attachments/{file.Id}")).Content.ReadAsByteArrayAsync(Ct));
    }
}
