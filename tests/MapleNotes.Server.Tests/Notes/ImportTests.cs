using System.Net;
using System.Net.Http.Json;
using MapleNotes.Server.Domain;
using MapleNotes.Server.Features.Attachments;
using MapleNotes.Server.Features.Notes;
using MapleNotes.Server.Infrastructure.Configuration;
using MapleNotes.Server.Tests.TestSupport;
using Microsoft.AspNetCore.Mvc;

namespace MapleNotes.Server.Tests.Notes;

/// <summary>
/// Restoring notes from an export: original IDs, dates and state are kept, notes the account has are skipped, IDs of
/// other accounts are never reused or revealed, and end-to-end accounts restore ciphertext.
/// </summary>
public sealed class ImportTests : IAsyncLifetime
{
    private static readonly DateTime Created = new(2024, 12, 31, 23, 30, 0, DateTimeKind.Utc);
    private static readonly DateTime Updated = new(2025, 1, 2, 8, 0, 0, DateTimeKind.Utc);

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
    public async Task A_restored_note_keeps_its_id_dates_state_kind_and_files()
    {
        var id = Guid.CreateVersion7();
        var upload = await EndToEndAccount.ReadAsync<AttachmentResponse>(await _client.UploadAsync([1, 2, 3], "photo.png", "image/png"));

        var response = await _client.PostJsonAsync("/api/v1/notes/import", new ImportNoteRequest(
            Created, Updated, id, "# Packing\n\n- [x] tent #trip", AttachmentIds: [upload.Id], IsPinned: true, IsArchived: true, Kind: NoteKind.Todo));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var note = (await response.Content.ReadFromJsonAsync<ImportNoteResponse>(ApiClient.Json, Ct))!.Note;
        Assert.Equal((id, Created, Updated, true, true, NoteKind.Todo), (note.Id, note.CreatedAtUtc, note.UpdatedAtUtc, note.IsPinned, note.IsArchived, note.Kind));
        Assert.Equal(["trip"], note.Tags);
        Assert.Equal(upload.Id, Assert.Single(note.Attachments).Id);
    }

    [Fact]
    public async Task Restoring_twice_skips_notes_the_account_has()
    {
        var id = Guid.CreateVersion7();
        var request = new ImportNoteRequest(Created, Updated, id, "Only once");

        var first = await _client.PostJsonAsync("/api/v1/notes/import", request);
        var second = await _client.PostJsonAsync("/api/v1/notes/import", request with { Content = "changed" });
        var existing = await _client.PostJsonAsync("/api/v1/notes/import/existing", new ImportExistingRequest([id, Guid.CreateVersion7()]));

        Assert.Equal((HttpStatusCode.Created, HttpStatusCode.OK), (first.StatusCode, second.StatusCode));
        var skipped = (await second.Content.ReadFromJsonAsync<ImportNoteResponse>(ApiClient.Json, Ct))!;
        Assert.Equal((false, "Only once"), (skipped.Imported, skipped.Note.Content));
        Assert.Equal([id], (await existing.Content.ReadFromJsonAsync<ImportExistingResponse>(ApiClient.Json, Ct))!.Existing);
        Assert.Single((await _client.GetJsonAsync<NotePageResponse>("/api/v1/notes"))!.Items);
    }

    [Fact]
    public async Task Another_accounts_ids_are_neither_reused_nor_revealed()
    {
        using var other = new ApiClient(_app);
        await other.SignUpAsync("birch");
        var theirs = await EndToEndAccount.ReadAsync<NoteResponse>(await other.PostJsonAsync("/api/v1/notes", new CreateNoteRequest("theirs")));

        var existing = await _client.PostJsonAsync("/api/v1/notes/import/existing", new ImportExistingRequest([theirs.Id]));
        var imported = await _client.PostJsonAsync("/api/v1/notes/import", new ImportNoteRequest(Created, Updated, theirs.Id, "mine"));

        Assert.Empty((await existing.Content.ReadFromJsonAsync<ImportExistingResponse>(ApiClient.Json, Ct))!.Existing);
        var note = (await imported.Content.ReadFromJsonAsync<ImportNoteResponse>(ApiClient.Json, Ct))!.Note;
        Assert.NotEqual(theirs.Id, note.Id); // a new ID
        Assert.Equal("theirs", (await other.GetJsonAsync<NoteResponse>($"/api/v1/notes/{theirs.Id}"))!.Content);
    }

    [Fact]
    public async Task A_daily_note_keeps_its_day_unless_the_day_is_taken()
    {
        var day = new DateOnly(2025, 1, 1);
        var first = await Import(new ImportNoteRequest(Created, Updated, Guid.CreateVersion7(), "# New Year", DailyDate: day));
        var second = await Import(new ImportNoteRequest(Created, Updated, Guid.CreateVersion7(), "# Also New Year", DailyDate: day));

        Assert.Equal(day, first.DailyDate);
        Assert.Null(second.DailyDate); // restored as an ordinary note
    }

    [Fact]
    public async Task Invalid_imports_are_rejected()
    {
        var future = await _client.PostJsonAsync("/api/v1/notes/import", new ImportNoteRequest(DateTime.UtcNow.AddDays(3), DateTime.UtcNow.AddDays(3), Content: "x"));
        var empty = await _client.PostJsonAsync("/api/v1/notes/import", new ImportNoteRequest(Created, Updated, Content: " "));
        var tooMany = await _client.PostJsonAsync("/api/v1/notes/import/existing", new ImportExistingRequest(Enumerable.Range(0, 501).Select(_ => Guid.NewGuid()).ToList()));
        var encryptedForPlain = await _client.PostJsonAsync("/api/v1/notes/import", new ImportNoteRequest(Created, Updated, Guid.CreateVersion7(), Encrypted: new EncryptedNote(new byte[40])));

        Assert.Contains("createdAtUtc", (await future.Content.ReadFromJsonAsync<ValidationProblemDetails>(Ct))!.Errors.Keys);
        Assert.Contains("content", (await empty.Content.ReadFromJsonAsync<ValidationProblemDetails>(Ct))!.Errors.Keys);
        Assert.Equal(HttpStatusCode.BadRequest, tooMany.StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, encryptedForPlain.StatusCode);
        Assert.Empty((await _client.GetJsonAsync<NotePageResponse>("/api/v1/notes?state=active&kind=note&kind=todo&kind=quick"))!.Items);
    }

    [Fact]
    public async Task End_to_end_accounts_restore_ciphertext_under_the_original_id()
    {
        var account = await EndToEndAccount.EnableAsync(_client);
        var old = Guid.CreateVersion7(new DateTimeOffset(Created));
        using var other = new ApiClient(_app);
        await other.SignUpAsync("birch");
        var theirs = await EndToEndAccount.ReadAsync<NoteResponse>(await other.PostJsonAsync("/api/v1/notes", new CreateNoteRequest("theirs")));

        var restored = await Import(new ImportNoteRequest(Created, Updated, old, Encrypted: account.EncryptNote(old, "secret from 2024")));
        var plain = await _client.PostJsonAsync("/api/v1/notes/import", new ImportNoteRequest(Created, Updated, Guid.CreateVersion7(), "plain"));
        var taken = await _client.PostJsonAsync("/api/v1/notes/import", new ImportNoteRequest(Created, Updated, theirs.Id, Encrypted: account.EncryptNote(theirs.Id, "x")));
        var notV7 = await _client.PostJsonAsync("/api/v1/notes/import", new ImportNoteRequest(Created, Updated, Guid.NewGuid(), Encrypted: account.EncryptNote(Guid.NewGuid(), "x")));

        Assert.Equal((old, Created), (restored.Id, restored.CreatedAtUtc));
        Assert.Equal("secret from 2024", account.Decrypt(restored));
        Assert.Equal(HttpStatusCode.Conflict, plain.StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, taken.StatusCode); // encrypt again for a new ID
        Assert.Equal(HttpStatusCode.BadRequest, notV7.StatusCode);
    }

    private async Task<NoteResponse> Import(ImportNoteRequest request)
    {
        var response = await _client.PostJsonAsync("/api/v1/notes/import", request);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<ImportNoteResponse>(ApiClient.Json, Ct))!.Note;
    }
}
