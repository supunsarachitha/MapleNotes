using System.Net;
using System.Net.Http.Json;
using MapleNotes.Server.Domain;
using MapleNotes.Server.Features.Attachments;
using MapleNotes.Server.Features.Auth;
using MapleNotes.Server.Features.Encryption;
using MapleNotes.Server.Features.EndToEnd;
using MapleNotes.Server.Features.Notes;
using MapleNotes.Server.Features.Storage;
using MapleNotes.Server.Infrastructure.Configuration;
using MapleNotes.Server.Tests.TestSupport;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.DependencyInjection;

namespace MapleNotes.Server.Tests.Auth;

/// <summary>
/// Deleting all of one's notes and files: everything the account wrote goes, and the account stays, with its sign-in
/// details, encryption keys, settings and sessions. Other accounts are untouched, and a wrong password deletes nothing.
/// </summary>
public sealed class DeleteContentTests : IAsyncLifetime
{
    private readonly MapleAppFactory _app = new() { Settings = { [MapleOptions.AllowRegistrationKey] = "true" } };
    private ApiClient _member = null!;
    private ApiClient _other = null!;

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    public async ValueTask InitializeAsync()
    {
        _other = new ApiClient(_app);
        _member = new ApiClient(_app);
        await _other.SignUpAsync("other");
        await _member.SignUpAsync("member");
    }

    public async ValueTask DisposeAsync()
    {
        _member.Dispose();
        _other.Dispose();
        await _app.DisposeAsync();
    }

    [Fact]
    public async Task Everything_the_account_wrote_goes_and_the_account_stays()
    {
        var photo = await EndToEndAccount.ReadAsync<AttachmentResponse>(await _member.UploadAsync(new byte[50_000], "photo.png", "image/png"));
        await _member.UploadAsync(new byte[1_000], "pending.pdf", "application/pdf"); // uploaded, never attached
        await CreateAsync(_member, new CreateNoteRequest("With a photo #garden/log", [photo.Id]));
        await CreateAsync(_member, new CreateNoteRequest("# Groceries\n\n- [ ] oats", Kind: NoteKind.Todo));
        await CreateAsync(_member, new CreateNoteRequest("Call the vet", Kind: NoteKind.Quick));
        await CreateAsync(_member, new CreateNoteRequest("# Walk\n\n- 2026-09-29", Kind: NoteKind.Habit));
        await CreateAsync(_member, new CreateNoteRequest("# Today", DailyDate: new DateOnly(2026, 9, 29)));
        var archived = await CreateAsync(_member, new CreateNoteRequest("Old #archive"));
        await _member.PatchJsonAsync($"/api/v1/notes/{archived.Id}", new PatchNoteRequest(IsArchived: true));
        var preferences = new UserPreferences { HabitTracker = true, Theme = "Dark", Accent = "Forest" };
        (await _member.PutJsonAsync("/api/v1/account/preferences", preferences)).EnsureSuccessStatusCode();
        var othersFile = await EndToEndAccount.ReadAsync<AttachmentResponse>(await _other.UploadAsync(new byte[3_000], "theirs.bin"));
        var othersNote = await CreateAsync(_other, new CreateNoteRequest("Not yours #garden", [othersFile.Id]));

        var response = await DeleteContentAsync(_member, await _member.ProofAsync());

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(new DeletedContentResponse(6, 2), await response.Content.ReadFromJsonAsync<DeletedContentResponse>(ApiClient.Json, Ct));
        var usage = await _member.GetJsonAsync<StorageUsageResponse>("/api/v1/account/storage");
        Assert.Equal((0, 0, 0L), (usage!.NoteCount, usage.FileCount, usage.TotalBytes));
        Assert.Empty(await IdsAsync(_member, "/api/v1/notes?state=active&kind=note&kind=todo&kind=quick&kind=habit"));
        Assert.Empty(await IdsAsync(_member, "/api/v1/notes?state=archived&kind=note&kind=todo&kind=quick&kind=habit"));
        Assert.Empty((await _member.GetJsonAsync<List<TagResponse>>("/api/v1/tags?kind=note&kind=todo&kind=quick&kind=habit"))!);
        Assert.Equal(preferences, await _member.GetJsonAsync<UserPreferences>("/api/v1/account/preferences"));

        // The other account keeps its note, tag and file, on disk too.
        Assert.Equal([othersNote.Id], await IdsAsync(_other, "/api/v1/notes"));
        Assert.Equal(HttpStatusCode.OK, (await _other.GetAsync($"/api/v1/attachments/{othersFile.Id}")).StatusCode);
        var options = _app.Services.GetRequiredService<MapleOptions>();
        Assert.Single(Directory.EnumerateFiles(options.AttachmentsDirectory, "*", SearchOption.AllDirectories));

        // The session carries on, a new sign-in works, and the empty account takes new notes, even for the same day.
        await CreateAsync(_member, new CreateNoteRequest("A fresh start", DailyDate: new DateOnly(2026, 9, 29)));
        using var laptop = new ApiClient(_app);
        Assert.Equal(HttpStatusCode.OK, (await laptop.LoginAsync("member")).StatusCode);
    }

    [Fact]
    public async Task A_wrong_password_deletes_nothing()
    {
        var note = await CreateAsync(_member, new CreateNoteRequest("Keep me"));

        var response = await DeleteContentAsync(_member, await _member.ProofAsync("not the password"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("password", (await response.Content.ReadFromJsonAsync<ValidationProblemDetails>(Ct))!.Errors.Keys);
        Assert.Equal([note.Id], await IdsAsync(_member, "/api/v1/notes"));
    }

    [Fact]
    public async Task End_to_end_accounts_keep_their_keys_and_carry_on_encrypted()
    {
        var account = await EndToEndAccount.EnableAsync(_member);
        var id = Guid.CreateVersion7();
        await CreateAsync(_member, new CreateNoteRequest(Id: id, Encrypted: account.EncryptNote(id, "secret")));
        var keyBefore = (await _member.GetJsonAsync<E2eeKeyResponse>("/api/v1/account/e2ee"))!.WrappedKey;

        (await DeleteContentAsync(_member, await _member.ProofAsync())).EnsureSuccessStatusCode();

        Assert.Equal(keyBefore, (await _member.GetJsonAsync<E2eeKeyResponse>("/api/v1/account/e2ee"))!.WrappedKey);
        Assert.Equal(account.DataKey, await account.UnlockAsync(_member)); // the same password still opens the same key
        var status = await _member.GetJsonAsync<EncryptionStatusResponse>("/api/v1/account/encryption");
        Assert.Equal((EncryptionMode.EndToEnd, 0), (status!.Mode, status.TotalItems));
        var next = Guid.CreateVersion7();
        var created = await CreateAsync(_member, new CreateNoteRequest(Id: next, Encrypted: account.EncryptNote(next, "new secret")));
        Assert.Equal("new secret", account.Decrypt(created));
    }

    private static async Task<HttpResponseMessage> DeleteContentAsync(ApiClient client, CredentialProof proof)
    {
        using var request = new HttpRequestMessage(HttpMethod.Delete, "/api/v1/account/content")
        {
            Content = JsonContent.Create(new DeleteContentRequest(proof), options: ApiClient.Json),
        };
        return await client.Http.SendAsync(request, Ct);
    }

    private static async Task<NoteResponse> CreateAsync(ApiClient client, CreateNoteRequest request)
    {
        var response = await client.PostJsonAsync("/api/v1/notes", request);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<NoteResponse>(ApiClient.Json, Ct))!;
    }

    private static async Task<List<Guid>> IdsAsync(ApiClient client, string url) =>
        (await client.GetJsonAsync<NotePageResponse>(url))!.Items.Select(n => n.Id).ToList();
}
