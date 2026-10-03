using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using MapleNotes.Server.Features.Attachments;
using MapleNotes.Server.Features.Notes;
using MapleNotes.Server.Infrastructure.Configuration;
using MapleNotes.Server.Infrastructure.Crypto;
using MapleNotes.Server.Infrastructure.Persistence;
using MapleNotes.Server.Infrastructure.Storage;
using MapleNotes.Server.Tests.TestSupport;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace MapleNotes.Server.Tests.Notes;

public sealed class AttachmentsApiTests : IAsyncLifetime
{
    private static readonly byte[] PngHeader = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

    private readonly MapleAppFactory _app = new()
    {
        Settings = { [MapleOptions.AllowRegistrationKey] = "true", [MapleOptions.MaxUploadMegabytesKey] = "1" },
    };

    private ApiClient _client = null!;

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    public async ValueTask InitializeAsync()
    {
        _client = new ApiClient(_app);
        await _client.SignUpAsync("maple");
    }

    [Fact]
    public async Task Uploaded_file_is_encrypted_on_disk_and_downloads_intact()
    {
        var content = RandomNumberGenerator.GetBytes(200_000);

        var attachment = await UploadAsync(content, "data.bin");
        var downloaded = await _client.Http.GetByteArrayAsync(attachment.Url, Ct);

        Assert.Equal(content, downloaded);
        Assert.Equal(200_000, attachment.SizeBytes);
        var onDisk = await File.ReadAllBytesAsync(StoredPath(await StorageKeyAsync(attachment.Id)), Ct);
        Assert.True(AttachmentCipher.HasEncryptedHeader(onDisk));
        Assert.Equal(-1, onDisk.AsSpan().IndexOf(content.AsSpan(0, 64)));
    }

    [Fact]
    public async Task Range_requests_return_the_requested_bytes_across_chunk_boundaries()
    {
        var content = RandomNumberGenerator.GetBytes(300_000);
        var attachment = await UploadAsync(content, "video.mp4", "video/mp4");

        using var request = new HttpRequestMessage(HttpMethod.Get, attachment.Url);
        request.Headers.Range = new RangeHeaderValue(65_500, 65_600); // spans the first 64 KiB chunk boundary
        var response = await _client.Http.SendAsync(request, Ct);

        Assert.Equal(HttpStatusCode.PartialContent, response.StatusCode);
        Assert.Equal(content.AsSpan(65_500, 101).ToArray(), await response.Content.ReadAsByteArrayAsync(Ct));
        Assert.Equal(300_000, response.Content.Headers.ContentRange!.Length);
    }

    [Fact]
    public async Task Images_are_served_inline_with_protective_headers()
    {
        var attachment = await UploadAsync([.. PngHeader, .. new byte[100]], "photo.png", "image/png");

        var response = await _client.GetAsync(attachment.Url);

        Assert.True(attachment.IsImage);
        Assert.Equal("image/png", response.Content.Headers.ContentType!.MediaType);
        Assert.Equal("inline", response.Content.Headers.ContentDisposition!.DispositionType);
        Assert.Equal("nosniff", Assert.Single(response.Headers.GetValues("X-Content-Type-Options")));
        Assert.Contains("sandbox", Assert.Single(response.Headers.GetValues("Content-Security-Policy")), StringComparison.Ordinal);
        Assert.True(response.Headers.CacheControl!.NoStore); // decrypted files are not left in the browser's cache
    }

    [Fact]
    public async Task Images_download_under_their_name_when_asked()
    {
        var attachment = await UploadAsync([.. PngHeader, .. new byte[100]], "beach day.png", "image/png");

        var response = await _client.GetAsync($"{attachment.Url}&download=true"); // the web app's download links

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("attachment", response.Content.Headers.ContentDisposition!.DispositionType);
        Assert.Equal("beach day.png", response.Content.Headers.ContentDisposition.FileNameStar ?? response.Content.Headers.ContentDisposition.FileName);
    }

    [Theory]
    [InlineData("drawing.svg", "image/svg+xml")]
    [InlineData("page.html", "text/html")]
    [InlineData("script.js", "text/javascript")]
    public async Task Active_content_is_only_ever_downloaded(string fileName, string contentType)
    {
        var attachment = await UploadAsync("<script>alert(1)</script>"u8.ToArray(), fileName, contentType);

        var response = await _client.GetAsync(attachment.Url);

        Assert.Equal("application/octet-stream", response.Content.Headers.ContentType!.MediaType);
        Assert.Equal("attachment", response.Content.Headers.ContentDisposition!.DispositionType);
        Assert.Equal(contentType, attachment.ContentType); // the real type is kept for exports
    }

    [Fact]
    public async Task Oversized_uploads_are_rejected_and_leave_nothing_behind()
    {
        var response = await _client.UploadAsync(new byte[(1024 * 1024) + 1], "big.bin");

        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, response.StatusCode);
        Assert.Empty(Directory.GetFiles(Path.Combine(_app.DataDirectory, "attachments"), "*", SearchOption.AllDirectories));
    }

    [Fact]
    public async Task Upload_without_a_file_is_rejected()
    {
        using var form = new MultipartFormDataContent { { new StringContent("value"), "field" } };

        var response = await _client.Http.PostAsync("/api/v1/attachments", form, Ct);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task File_names_are_sanitized()
    {
        var attachment = await UploadAsync([1, 2, 3], "../../etc/passwd");

        Assert.Equal("passwd", attachment.FileName);
    }

    [Fact]
    public async Task Attachments_link_to_one_note_only()
    {
        var attachment = await UploadAsync([1, 2, 3], "a.txt", "text/plain");

        var first = await _client.PostJsonAsync("/api/v1/notes", new CreateNoteRequest("with file", [attachment.Id]));
        var second = await _client.PostJsonAsync("/api/v1/notes", new CreateNoteRequest("steal it", [attachment.Id]));

        var note = await first.Content.ReadFromJsonAsync<NoteResponse>(ApiClient.Json, Ct);
        Assert.Equal([attachment.Id], note!.Attachments.Select(a => a.Id));
        Assert.Equal(HttpStatusCode.BadRequest, second.StatusCode);
    }

    [Fact]
    public async Task A_note_may_consist_of_attachments_only()
    {
        var attachment = await UploadAsync([.. PngHeader], "photo.png", "image/png");

        var response = await _client.PostJsonAsync("/api/v1/notes", new CreateNoteRequest(string.Empty, [attachment.Id]));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    }

    [Fact]
    public async Task Removing_an_attachment_from_a_note_deletes_the_file()
    {
        var keep = await UploadAsync([1], "keep.txt", "text/plain");
        var drop = await UploadAsync([2], "drop.txt", "text/plain");
        var created = await _client.PostJsonAsync("/api/v1/notes", new CreateNoteRequest("files", [keep.Id, drop.Id]));
        var note = await created.Content.ReadFromJsonAsync<NoteResponse>(ApiClient.Json, Ct);
        var dropPath = StoredPath(await StorageKeyAsync(drop.Id));

        var response = await _client.PutJsonAsync($"/api/v1/notes/{note!.Id}", new UpdateNoteRequest("files", [keep.Id]));
        var updated = await response.Content.ReadFromJsonAsync<NoteResponse>(ApiClient.Json, Ct);

        Assert.Equal([keep.Id], updated!.Attachments.Select(a => a.Id));
        Assert.False(File.Exists(dropPath));
        Assert.Equal(HttpStatusCode.NotFound, (await _client.GetAsync(drop.Url)).StatusCode);
    }

    [Fact]
    public async Task Deleting_a_note_deletes_its_files()
    {
        var attachment = await UploadAsync([1, 2, 3], "a.txt", "text/plain");
        var created = await _client.PostJsonAsync("/api/v1/notes", new CreateNoteRequest("with file", [attachment.Id]));
        var note = await created.Content.ReadFromJsonAsync<NoteResponse>(ApiClient.Json, Ct);
        var path = StoredPath(await StorageKeyAsync(attachment.Id));

        await _client.DeleteAsync($"/api/v1/notes/{note!.Id}");

        Assert.False(File.Exists(path));
    }

    [Fact]
    public async Task Other_users_cannot_download_or_delete_a_file()
    {
        var attachment = await UploadAsync([1, 2, 3], "private.txt", "text/plain");
        using var intruder = new ApiClient(_app);
        await intruder.SignUpAsync("intruder");

        Assert.Equal(HttpStatusCode.NotFound, (await intruder.GetAsync(attachment.Url)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await intruder.DeleteAsync(attachment.Url)).StatusCode);
        var steal = await intruder.PostJsonAsync("/api/v1/notes", new CreateNoteRequest("mine now", [attachment.Id]));
        Assert.Equal(HttpStatusCode.BadRequest, steal.StatusCode);
    }

    [Fact]
    public async Task Cleanup_removes_abandoned_uploads_and_orphan_files_only()
    {
        var abandoned = await UploadAsync([1], "abandoned.txt", "text/plain");
        var linked = await UploadAsync([2], "linked.txt", "text/plain");
        await _client.PostJsonAsync("/api/v1/notes", new CreateNoteRequest("keeps its file", [linked.Id]));

        using var scope = _app.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<MapleDbContext>();
        var store = scope.ServiceProvider.GetRequiredService<AttachmentStore>();
        var orphanKey = AttachmentStore.CreateStorageKey(Guid.CreateVersion7());
        await store.WriteAsync(orphanKey, (s, ct) => s.WriteAsync(new byte[] { 9 }, ct).AsTask(), cancellationToken: Ct);
        File.SetLastWriteTimeUtc(StoredPath(orphanKey), DateTime.UtcNow.AddHours(-2));

        var later = new ManualTimeProvider(DateTimeOffset.UtcNow.AddHours(25));
        var result = await new AttachmentCleanup(db, store, later).RunAsync(Ct);

        Assert.Equal(1, result.AbandonedUploads);
        Assert.Equal(1, result.OrphanFiles);
        Assert.Equal(HttpStatusCode.NotFound, (await _client.GetAsync(abandoned.Url)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await _client.GetAsync(linked.Url)).StatusCode);
        Assert.False(store.Exists(orphanKey));
    }

    public async ValueTask DisposeAsync()
    {
        _client.Dispose();
        await _app.DisposeAsync();
    }

    private async Task<AttachmentResponse> UploadAsync(byte[] content, string fileName, string contentType = "application/octet-stream")
    {
        var response = await _client.UploadAsync(content, fileName, contentType);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<AttachmentResponse>(ApiClient.Json, Ct))!;
    }

    private async Task<string> StorageKeyAsync(Guid attachmentId)
    {
        using var scope = _app.Services.CreateScope();
        return await scope.ServiceProvider.GetRequiredService<MapleDbContext>().Attachments
            .Where(a => a.Id == attachmentId).Select(a => a.StorageKey).SingleAsync(Ct);
    }

    private string StoredPath(string storageKey) => Path.Combine(_app.DataDirectory, "attachments", storageKey);
}
