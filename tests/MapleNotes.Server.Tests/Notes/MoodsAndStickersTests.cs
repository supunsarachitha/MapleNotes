using System.IO.Compression;
using System.Net;
using System.Net.Http.Json;
using System.Text;
using MapleNotes.Server.Domain;
using MapleNotes.Server.Features.Attachments;
using MapleNotes.Server.Features.Export;
using MapleNotes.Server.Features.Notes;
using MapleNotes.Server.Infrastructure.Configuration;
using MapleNotes.Server.Tests.TestSupport;
using Microsoft.AspNetCore.Mvc;

namespace MapleNotes.Server.Tests.Notes;

/// <summary>
/// Moods and stickers: kept on notes and files, refused or dropped where they cannot be, written into exports as
/// Falcon Notes 1.7.0 writes them, and never readable by the server for end-to-end accounts.
/// </summary>
public sealed class MoodsAndStickersTests : IAsyncLifetime
{
    private static readonly byte[] Png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3];

    private readonly MapleAppFactory _app = new() { RunEncryptionWorker = false, Settings = { [MapleOptions.AllowRegistrationKey] = "true" } };
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
    public async Task A_note_keeps_its_mood_until_an_edit_changes_it()
    {
        var note = await ReadAsync<NoteResponse>(await _client.PostJsonAsync("/api/v1/notes", new CreateNoteRequest("Sunny walk", Mood: NoteMood.Great)));
        var kept = await ReadAsync<NoteResponse>(await _client.PutJsonAsync($"/api/v1/notes/{note.Id}", new UpdateNoteRequest("Sunny walk, long")));
        var changed = await ReadAsync<NoteResponse>(await _client.PutJsonAsync($"/api/v1/notes/{note.Id}", new UpdateNoteRequest("Rain later", Mood: NoteMood.Bad)));
        var cleared = await ReadAsync<NoteResponse>(await _client.PutJsonAsync($"/api/v1/notes/{note.Id}", new UpdateNoteRequest("Rain later", Mood: NoteMood.None)));

        Assert.Equal((NoteMood?)NoteMood.Great, note.Mood);
        Assert.Equal((NoteMood?)NoteMood.Great, kept.Mood);
        Assert.Equal((NoteMood?)NoteMood.Bad, changed.Mood);
        Assert.Null(cleared.Mood);
        Assert.Contains("\"mood\":\"Bad\"", await (await _client.PutJsonAsync($"/api/v1/notes/{note.Id}", new UpdateNoteRequest("x", Mood: NoteMood.Bad))).Content.ReadAsStringAsync(Ct));
    }

    [Fact]
    public async Task Only_notes_and_quick_notes_have_moods()
    {
        var quick = await ReadAsync<NoteResponse>(await _client.PostJsonAsync("/api/v1/notes", new CreateNoteRequest("Idea", Kind: NoteKind.Quick, Mood: NoteMood.Good)));
        var todo = await _client.PostJsonAsync("/api/v1/notes", new CreateNoteRequest("- [ ] milk", Kind: NoteKind.Todo, Mood: NoteMood.Good));
        var unknown = await _client.PostJsonAsync("/api/v1/notes", new CreateNoteRequest("Hm", Mood: (NoteMood)9));
        var restored = await ReadAsync<ImportNoteResponse>(await _client.PostJsonAsync("/api/v1/notes/import", new ImportNoteRequest(
            DateTime.UtcNow.AddDays(-1), DateTime.UtcNow.AddDays(-1), Content: "- [ ] eggs", Kind: NoteKind.Todo, Mood: NoteMood.Okay)));
        var moved = await ReadAsync<NoteResponse>(await _client.PatchJsonAsync($"/api/v1/notes/{quick.Id}", new PatchNoteRequest(Kind: NoteKind.Todo)));

        Assert.Equal((NoteMood?)NoteMood.Good, quick.Mood);
        Assert.Equal(HttpStatusCode.BadRequest, todo.StatusCode);
        Assert.Contains("mood", (await todo.Content.ReadFromJsonAsync<ValidationProblemDetails>(Ct))!.Errors.Keys);
        Assert.Equal(HttpStatusCode.BadRequest, unknown.StatusCode);
        Assert.Null(restored.Note.Mood); // a restore drops what cannot be, rather than failing the note
        Assert.Null(moved.Mood);
    }

    [Fact]
    public async Task Only_pictures_become_stickers()
    {
        var sticker = await ReadAsync<AttachmentResponse>(await _client.UploadAsync(Png, "cat.png", "image/png", sticker: true));
        var picture = await ReadAsync<AttachmentResponse>(await _client.UploadAsync(Png, "sunset.png", "image/png"));
        var document = await ReadAsync<AttachmentResponse>(await _client.UploadAsync([1, 2], "notes.pdf", "application/pdf", sticker: true));

        var note = await ReadAsync<NoteResponse>(await _client.PostJsonAsync("/api/v1/notes", new CreateNoteRequest("Hi", [sticker.Id, picture.Id, document.Id])));

        Assert.Equal([true, false, false], note.Attachments.Select(a => a.IsSticker));
    }

    [Fact]
    public async Task Exports_write_moods_and_stickers_as_Falcon_Notes_does_and_leave_other_notes_unchanged()
    {
        var sticker = await ReadAsync<AttachmentResponse>(await _client.UploadAsync(Png, "cat.png", "image/png", sticker: true));
        var picture = await ReadAsync<AttachmentResponse>(await _client.UploadAsync(Png, "sunset.png", "image/png"));
        await _client.PostJsonAsync("/api/v1/notes", new CreateNoteRequest("Happy day", [picture.Id, sticker.Id], Mood: NoteMood.Great));
        await _client.PostJsonAsync("/api/v1/notes", new CreateNoteRequest("Plain"));
        var catPath = $"attachments/{sticker.Id.ToString("N")[^8..]}_cat.png";

        var md = await ExportAsync("md");
        var txt = await ExportAsync("txt");
        var json = await ExportAsync("json");

        var happyMd = md.Single(e => e.Value.Contains("Happy day")).Value;
        Assert.Contains("archived: false\nmood: great\nattachments:\n", happyMd);
        Assert.Contains($"\nstickers:\n  - \"{catPath}\"\n---\n", happyMd);
        var plainMd = md.Single(e => e.Value.Contains("Plain")).Value;
        Assert.DoesNotContain("mood", plainMd);
        Assert.DoesNotContain("stickers", plainMd);

        var happyTxt = txt.Single(e => e.Value.Contains("Happy day")).Value;
        Assert.Contains("\nMood: great\nAttachment: ", happyTxt);
        Assert.Contains($"\nSticker: {catPath}\n\nHappy day\n", happyTxt);

        var happyJson = json.Single(e => e.Value.Contains("Happy day")).Value;
        Assert.Contains("\"archived\": false,\n  \"mood\": \"great\",\n  \"content\": \"Happy day\"", happyJson);
        Assert.EndsWith($"\"stickers\": [\n    \"{catPath}\"\n  ]\n}}\n", happyJson);
        Assert.DoesNotContain("mood", json.Single(e => e.Value.Contains("Plain")).Value);
    }

    [Fact]
    public async Task An_end_to_end_mood_is_only_ever_ciphertext_and_survives_old_browsers()
    {
        var account = await EndToEndAccount.EnableAsync(_client);
        var id = Guid.CreateVersion7();
        var created = await ReadAsync<NoteResponse>(await _client.PostJsonAsync("/api/v1/notes",
            new CreateNoteRequest(Id: id, Encrypted: account.EncryptNote(id, "Secret walk", "great"))));
        var oldBrowser = await ReadAsync<NoteResponse>(await _client.PutJsonAsync($"/api/v1/notes/{id}",
            new UpdateNoteRequest(Encrypted: account.EncryptNote(id, "Secret walk, edited"))));
        var plainMood = await _client.PutJsonAsync($"/api/v1/notes/{id}", new UpdateNoteRequest("leak", Mood: NoteMood.Good));
        var malformed = await _client.PutJsonAsync($"/api/v1/notes/{id}",
            new UpdateNoteRequest(Encrypted: account.EncryptNote(id, "x") with { Mood = new byte[200] }));

        Assert.Null(created.Mood);
        Assert.Equal("great", account.DecryptMood(created));
        Assert.Equal("great", account.DecryptMood(oldBrowser)); // a browser from before moods sends none: the mood stays
        Assert.Equal(HttpStatusCode.Conflict, plainMood.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, malformed.StatusCode);
    }

    [Fact]
    public async Task Converting_to_and_from_end_to_end_carries_moods_and_stickers()
    {
        var sticker = await ReadAsync<AttachmentResponse>(await _client.UploadAsync(Png, "cat.png", "image/png", sticker: true));
        var note = await ReadAsync<NoteResponse>(await _client.PostJsonAsync("/api/v1/notes", new CreateNoteRequest("Rainy", [sticker.Id], Mood: NoteMood.Bad)));
        var account = await EndToEndAccount.EnableAsync(_client);

        await new BrowserConverter(_client, account).RunAsync();
        var encrypted = (await _client.GetJsonAsync<NoteResponse>($"/api/v1/notes/{note.Id}"))!;
        var metadata = account.OpenMetadata(sticker.Id, Assert.Single(encrypted.Attachments).EncryptedMetadata!);

        Assert.Null(encrypted.Mood);
        Assert.Equal("bad", account.DecryptMood(encrypted));
        Assert.False(encrypted.Attachments[0].IsSticker); // the flag now travels encrypted
        Assert.Contains("\"sticker\":1", metadata);

        (await account.SetModeAsync(_client, EncryptionMode.AtRest)).EnsureSuccessStatusCode();
        await new BrowserConverter(_client, account).RunAsync();
        var plain = (await _client.GetJsonAsync<NoteResponse>($"/api/v1/notes/{note.Id}"))!;

        Assert.Equal((NoteMood?)NoteMood.Bad, plain.Mood);
        Assert.Null(plain.EncryptedMood);
        Assert.True(Assert.Single(plain.Attachments).IsSticker);
    }

    private async Task<Dictionary<string, string>> ExportAsync(string format)
    {
        var response = await _client.GetAsync($"/api/v1/export?format={format}&layout=flat&timeZone=UTC&includeAttachments=true");
        response.EnsureSuccessStatusCode();
        using var zip = new ZipArchive(await response.Content.ReadAsStreamAsync(Ct), ZipArchiveMode.Read);
        var entries = new Dictionary<string, string>();
        foreach (var entry in zip.Entries.Where(e => !e.FullName.StartsWith("attachments/", StringComparison.Ordinal) && e.FullName != "manifest.json"))
        {
            using var reader = new StreamReader(entry.Open(), Encoding.UTF8);
            entries[entry.FullName] = await reader.ReadToEndAsync(Ct);
        }

        return entries;
    }

    private static async Task<T> ReadAsync<T>(HttpResponseMessage response)
    {
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<T>(ApiClient.Json, Ct))!;
    }
}
