using System.Net;
using System.Net.Http.Json;
using MapleNotes.Server.Domain;
using MapleNotes.Server.Features.Admin;
using MapleNotes.Server.Features.Attachments;
using MapleNotes.Server.Features.Encryption;
using MapleNotes.Server.Features.Notes;
using MapleNotes.Server.Features.Storage;
using MapleNotes.Server.Infrastructure.Configuration;
using MapleNotes.Server.Tests.TestSupport;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.DependencyInjection;

namespace MapleNotes.Server.Tests.Storage;

/// <summary>
/// The storage limit per account: set by administrators only, counted like the account's own usage, refusing whatever
/// would pass it (uploads, new notes, growing edits, restores) while anything that frees space, and changing
/// encryption, always works.
/// </summary>
public sealed class StorageQuotaTests : IAsyncLifetime
{
    private const long OneMegabyte = 1024 * 1024;

    private readonly MapleAppFactory _app = new() { Settings = { [MapleOptions.AllowRegistrationKey] = "true" } };
    private ApiClient _admin = null!;
    private ApiClient _member = null!;

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

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
    public async Task There_is_no_limit_until_an_administrator_sets_one()
    {
        var settings = await _admin.GetJsonAsync<InstanceSettingsResponse>("/api/v1/admin/settings");
        var upload = await _member.UploadAsync(new byte[2 * OneMegabyte], "big.bin");

        Assert.Null(settings!.StorageQuotaMb);
        Assert.Equal(HttpStatusCode.Created, upload.StatusCode);
        Assert.Null((await UsageAsync()).QuotaBytes);
    }

    [Fact]
    public async Task Only_administrators_set_the_limit_and_it_must_be_in_range()
    {
        var byMember = await _member.PutJsonAsync("/api/v1/admin/settings", new UpdateInstanceSettingsRequest(true, 5));
        var zero = await _admin.PutJsonAsync("/api/v1/admin/settings", new UpdateInstanceSettingsRequest(true, 0));
        var negative = await _admin.PutJsonAsync("/api/v1/admin/settings", new UpdateInstanceSettingsRequest(true, -1));
        var tooBig = await _admin.PutJsonAsync("/api/v1/admin/settings", new UpdateInstanceSettingsRequest(true, InstanceSettingsService.MaxStorageQuotaMb + 1));

        Assert.Equal(HttpStatusCode.Forbidden, byMember.StatusCode);
        foreach (var refused in new[] { zero, negative, tooBig })
        {
            Assert.Contains("storageQuotaMb", (await refused.Content.ReadFromJsonAsync<ValidationProblemDetails>(Ct))!.Errors.Keys);
        }

        await SetLimitAsync(5);
        Assert.Equal(new InstanceSettingsResponse(true, 5), await _admin.GetJsonAsync<InstanceSettingsResponse>("/api/v1/admin/settings"));
        Assert.Equal(5 * OneMegabyte, (await UsageAsync()).QuotaBytes);

        await SetLimitAsync(null); // a request without a limit removes it
        Assert.Equal(new InstanceSettingsResponse(true, null), await _admin.GetJsonAsync<InstanceSettingsResponse>("/api/v1/admin/settings"));
    }

    [Fact]
    public async Task An_upload_that_does_not_fit_is_refused_and_nothing_is_kept()
    {
        await SetLimitAsync(1);

        var first = await _member.UploadAsync(new byte[700_000], "first.bin");
        var tooMuch = await _member.UploadAsync(new byte[400_000], "second.bin");
        var exactFit = await _member.UploadAsync(new byte[OneMegabyte - 700_000], "exact.bin");
        var oneMore = await _member.UploadAsync([1], "one-byte.bin");

        Assert.Equal((HttpStatusCode.Created, HttpStatusCode.Created), (first.StatusCode, exactFit.StatusCode));
        await AssertFullAsync(tooMuch);
        await AssertFullAsync(oneMore);
        var usage = await UsageAsync();
        Assert.Equal((2, OneMegabyte), (usage.FileCount, usage.FilesBytes));
        var options = _app.Services.GetRequiredService<MapleOptions>();
        Assert.Equal(2, Directory.EnumerateFiles(options.AttachmentsDirectory, "*", SearchOption.AllDirectories).Count());
    }

    [Fact]
    public async Task Other_accounts_and_administrators_have_their_own_room()
    {
        await SetLimitAsync(1);
        await _member.UploadAsync(new byte[OneMegabyte], "full.bin");

        await AssertFullAsync(await _member.UploadAsync([1], "more.bin"));
        Assert.Equal(HttpStatusCode.Created, (await _admin.UploadAsync(new byte[OneMegabyte], "admins-own.bin")).StatusCode);
        await AssertFullAsync(await _admin.UploadAsync([1], "admins-more.bin")); // the limit applies to administrators too
    }

    [Fact]
    public async Task Notes_that_do_not_fit_are_refused_while_shrinking_and_deleting_always_work()
    {
        await SetLimitAsync(1);
        var photo = await EndToEndAccount.ReadAsync<AttachmentResponse>(await _member.UploadAsync(new byte[OneMegabyte - 20_000], "photo.png", "image/png"));
        var note = await CreateAsync(new CreateNoteRequest(new string('a', 5_000), [photo.Id]));

        await AssertFullAsync(await _member.PostJsonAsync("/api/v1/notes", new CreateNoteRequest(new string('b', 20_000))));
        await AssertFullAsync(await _member.PutJsonAsync($"/api/v1/notes/{note.Id}", new UpdateNoteRequest(new string('a', 30_000))));
        Assert.Equal(HttpStatusCode.OK, (await _member.PutJsonAsync($"/api/v1/notes/{note.Id}", new UpdateNoteRequest("shorter"))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await _member.PatchJsonAsync($"/api/v1/notes/{note.Id}", new PatchNoteRequest(IsPinned: true))).StatusCode);

        // Removing the photo frees far more than the longer text takes.
        var trade = await _member.PutJsonAsync($"/api/v1/notes/{note.Id}", new UpdateNoteRequest(new string('c', 30_000), []));
        Assert.Equal(HttpStatusCode.OK, trade.StatusCode);
        Assert.Equal(0, (await UsageAsync()).FileCount);

        Assert.Equal(HttpStatusCode.NoContent, (await _member.DeleteAsync($"/api/v1/notes/{note.Id}")).StatusCode);
        Assert.Equal(0, (await UsageAsync()).TotalBytes);
    }

    [Fact]
    public async Task A_restore_stops_fitting_once_the_storage_is_full()
    {
        await SetLimitAsync(1);
        await _member.UploadAsync(new byte[OneMegabyte - 600], "nearly-full.bin");
        var created = new DateTime(2025, 1, 1, 9, 0, 0, DateTimeKind.Utc);

        var small = await _member.PostJsonAsync("/api/v1/notes/import", new ImportNoteRequest(created, created, Content: "short note"));
        var large = await _member.PostJsonAsync("/api/v1/notes/import", new ImportNoteRequest(created, created, Content: new string('x', 2_000)));

        Assert.Equal(HttpStatusCode.Created, small.StatusCode);
        await AssertFullAsync(large);
    }

    [Fact]
    public async Task Lowering_the_limit_keeps_what_an_account_has_but_it_cannot_grow()
    {
        var file = await EndToEndAccount.ReadAsync<AttachmentResponse>(await _member.UploadAsync(new byte[2 * OneMegabyte], "archive.zip"));
        await SetLimitAsync(1);

        var usage = await UsageAsync();
        Assert.True(usage.TotalBytes > usage.QuotaBytes);
        Assert.Equal(HttpStatusCode.OK, (await _member.GetAsync($"/api/v1/attachments/{file.Id}/info")).StatusCode);
        await AssertFullAsync(await _member.UploadAsync([1], "tiny.bin"));
        await AssertFullAsync(await _member.PostJsonAsync("/api/v1/notes", new CreateNoteRequest("hello")));

        Assert.Equal(HttpStatusCode.NoContent, (await _member.DeleteAsync($"/api/v1/attachments/{file.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.Created, (await _member.PostJsonAsync("/api/v1/notes", new CreateNoteRequest("hello"))).StatusCode);
    }

    [Fact]
    public async Task Two_uploads_at_once_cannot_both_take_the_last_of_the_room()
    {
        await SetLimitAsync(1);

        var both = await Task.WhenAll(_member.UploadAsync(new byte[600_000], "a.bin"), _member.UploadAsync(new byte[600_000], "b.bin"));

        Assert.Equal([HttpStatusCode.Created, HttpStatusCode.InsufficientStorage], both.Select(r => r.StatusCode).Order());
        Assert.Equal(600_000, (await UsageAsync()).FilesBytes);
    }

    [Fact]
    public async Task End_to_end_files_count_their_ciphertext()
    {
        var account = await EndToEndAccount.EnableAsync(_member);
        await SetLimitAsync(1);
        var fits = Guid.CreateVersion7();
        var tooBig = Guid.CreateVersion7();

        var first = await _member.UploadEncryptedAsync(fits, account.SealMetadata(fits, "a.bin", "application/octet-stream", 600_000),
            account.EncryptFile(fits, new byte[600_000]));
        var second = await _member.UploadEncryptedAsync(tooBig, account.SealMetadata(tooBig, "b.bin", "application/octet-stream", 600_000),
            account.EncryptFile(tooBig, new byte[600_000]));

        Assert.Equal(HttpStatusCode.Created, first.StatusCode);
        await AssertFullAsync(second);
        Assert.InRange((await UsageAsync()).FilesBytes, 600_001, 601_000); // the ciphertext, a little larger than the file
    }

    [Fact]
    public async Task Changing_encryption_is_never_blocked_by_the_limit()
    {
        for (var i = 0; i < 3; i++)
        {
            await CreateAsync(new CreateNoteRequest($"Note {i} #garden"));
        }

        var photo = await EndToEndAccount.ReadAsync<AttachmentResponse>(await _member.UploadAsync(new byte[300_000], "photo.png", "image/png"));
        await CreateAsync(new CreateNoteRequest("With a photo", [photo.Id]));
        await _member.UploadAsync(new byte[OneMegabyte], "archive.zip");
        await SetLimitAsync(1); // the account is now over its limit

        var account = await EndToEndAccount.EnableAsync(_member);
        var converted = await new BrowserConverter(_member, account).RunAsync();

        Assert.Equal(6, converted); // four notes and two files, each a little larger as end-to-end ciphertext
        var status = await _member.GetJsonAsync<EncryptionStatusResponse>("/api/v1/account/encryption");
        Assert.Equal((EncryptionMode.EndToEnd, 0), (status!.Mode, status.RemainingItems));
    }

    private async Task SetLimitAsync(int? megabytes) =>
        (await _admin.PutJsonAsync("/api/v1/admin/settings", new UpdateInstanceSettingsRequest(true, megabytes))).EnsureSuccessStatusCode();

    private async Task<StorageUsageResponse> UsageAsync() =>
        (await _member.GetJsonAsync<StorageUsageResponse>("/api/v1/account/storage"))!;

    private async Task<NoteResponse> CreateAsync(CreateNoteRequest request)
    {
        var response = await _member.PostJsonAsync("/api/v1/notes", request);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<NoteResponse>(ApiClient.Json, Ct))!;
    }

    private static async Task AssertFullAsync(HttpResponseMessage response)
    {
        Assert.Equal(HttpStatusCode.InsufficientStorage, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<ProblemDetails>(Ct);
        Assert.Equal("There is not enough room in your storage.", problem!.Title);
    }
}
