using System.Net;
using System.Net.Http.Json;
using MapleNotes.Server.Domain;
using MapleNotes.Server.Features.Attachments;
using MapleNotes.Server.Features.Notes;
using MapleNotes.Server.Features.Storage;
using MapleNotes.Server.Infrastructure.Configuration;
using MapleNotes.Server.Tests.TestSupport;

namespace MapleNotes.Server.Tests.Storage;

/// <summary>Storage usage: each account sees only its own; administrators see the instance's totals, never an account's.</summary>
public sealed class StorageTests : IAsyncLifetime
{
    private readonly MapleAppFactory _app = new() { Settings = { [MapleOptions.AllowRegistrationKey] = "true" } };
    private ApiClient _admin = null!;
    private ApiClient _member = null!;

    public async ValueTask InitializeAsync()
    {
        _admin = new ApiClient(_app);
        _member = new ApiClient(_app);
        await _admin.SignUpAsync("admin");
        await _member.SignUpAsync("member");
    }

    public async ValueTask DisposeAsync()
    {
        _admin.Dispose();
        _member.Dispose();
        await _app.DisposeAsync();
    }

    [Fact]
    public async Task A_new_account_stores_nothing()
    {
        Assert.Equal(new StorageUsageResponse(0, 0, 0, 0), await _member.GetJsonAsync<StorageUsageResponse>("/api/v1/account/storage"));
    }

    [Fact]
    public async Task Usage_counts_the_accounts_own_notes_and_files_only()
    {
        var photo = await EndToEndAccount.ReadAsync<AttachmentResponse>(await _member.UploadAsync(new byte[70_000], "photo.png", "image/png"));
        await _member.UploadAsync(new byte[5_000], "pending.pdf", "application/pdf"); // not attached yet, still stored
        await _member.PostJsonAsync("/api/v1/notes", new CreateNoteRequest("With a photo", [photo.Id]));
        var archived = await EndToEndAccount.ReadAsync<NoteResponse>(await _member.PostJsonAsync("/api/v1/notes", new CreateNoteRequest("# List", Kind: NoteKind.Todo)));
        await _member.PatchJsonAsync($"/api/v1/notes/{archived.Id}", new PatchNoteRequest(IsArchived: true));
        await _admin.UploadAsync(new byte[1_000_000], "not-mine.bin");

        var usage = await _member.GetJsonAsync<StorageUsageResponse>("/api/v1/account/storage");

        Assert.Equal((2, 2, 75_000L), (usage!.NoteCount, usage.FileCount, usage.FilesBytes));
        Assert.InRange(usage.NotesBytes, 1, 1_000); // encrypted at rest: the stored ciphertext
        Assert.Equal(usage.NotesBytes + usage.FilesBytes, usage.TotalBytes);
    }

    [Fact]
    public async Task Administrators_see_the_instances_totals_and_nobody_elses_usage()
    {
        await _member.UploadAsync(new byte[40_000], "big.bin");

        var denied = await _member.GetAsync("/api/v1/admin/storage");
        var instance = await _admin.GetJsonAsync<InstanceStorageResponse>("/api/v1/admin/storage");
        var adminsOwn = await _admin.GetJsonAsync<StorageUsageResponse>("/api/v1/account/storage");
        var users = await (await _admin.GetAsync("/api/v1/admin/users")).Content.ReadAsStringAsync(TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.Forbidden, denied.StatusCode);
        Assert.True(instance!.DatabaseBytes > 0 && instance.FilesBytes >= 40_000 && instance.FreeBytes > 0);
        Assert.Equal(instance.DatabaseBytes + instance.FilesBytes + instance.BackupsBytes, instance.TotalBytes);
        Assert.Equal(0, adminsOwn!.FilesBytes); // the member's file is not the admin's
        Assert.DoesNotContain("storage", users, StringComparison.OrdinalIgnoreCase); // no per-account usage for admins
    }
}
