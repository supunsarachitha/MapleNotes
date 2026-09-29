using System.Net;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using MapleNotes.Server.Domain;
using MapleNotes.Server.Features.Attachments;
using MapleNotes.Server.Features.Notes;
using MapleNotes.Server.Infrastructure.Configuration;
using MapleNotes.Server.Infrastructure.Persistence;
using MapleNotes.Server.Tests.TestSupport;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace MapleNotes.Server.Tests.E2ee;

/// <summary>
/// End-to-end encrypted attachments (docs/e2ee-spec.md §5): the server stores the browser's ciphertext and encrypted
/// metadata under the browser's ID, serves byte ranges of it, and never holds file names or contents.
/// </summary>
public sealed class EndToEndAttachmentsTests : IAsyncLifetime
{
    private const string Marker = "PLAINTEXT-MARKER-7731 ";

    private MapleAppFactory _app = new();
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
    public async Task Encrypted_files_are_stored_as_sent_and_served_back_as_ciphertext()
    {
        var (id, plaintext, ciphertext, _) = await UploadAsync(150_000);

        var info = await _client.GetJsonAsync<AttachmentResponse>($"/api/v1/attachments/{id}/info");
        var download = await _client.GetAsync($"/api/v1/attachments/{id}");
        using var rangeRequest = new HttpRequestMessage(HttpMethod.Get, $"/api/v1/attachments/{id}") { Headers = { Range = new RangeHeaderValue(42, 100) } };
        var range = await _client.Http.SendAsync(rangeRequest, Ct);

        Assert.Null(info!.FileName);
        Assert.Null(info.ContentType);
        Assert.False(info.IsImage);
        Assert.Equal(ciphertext.Length, info.SizeBytes);
        Assert.Equal("{\"name\":\"holiday Zanzibar.png\",\"type\":\"image/png\",\"size\":150000}", _account.OpenMetadata(id, info.EncryptedMetadata!));
        Assert.Equal(ciphertext, await download.Content.ReadAsByteArrayAsync(Ct));
        Assert.Equal("application/octet-stream", download.Content.Headers.ContentType!.MediaType);
        Assert.Equal($"{id:N}.bin", download.Content.Headers.ContentDisposition!.FileNameStar ?? download.Content.Headers.ContentDisposition.FileName);
        Assert.Equal("attachment", download.Content.Headers.ContentDisposition.DispositionType);
        Assert.Equal(HttpStatusCode.PartialContent, range.StatusCode);
        Assert.Equal(ciphertext[42..101], await range.Content.ReadAsByteArrayAsync(Ct));
        Assert.Equal(plaintext, _account.DecryptFile(id, ciphertext));
    }

    [Fact]
    public async Task The_database_and_the_disk_hold_no_file_names_and_no_contents()
    {
        var (id, _, _, _) = await UploadAsync(70_000);

        var leaks = await DatabaseScanner.ScanAsync(_app, "Zanzibar", "holiday", "image/png", Marker.Trim());
        var files = Directory.GetFiles(Path.Combine(_app.DataDirectory, "attachments"), "*.bin", SearchOption.AllDirectories);
        var onDisk = await File.ReadAllBytesAsync(Assert.Single(files), Ct);

        Assert.Empty(leaks);
        Assert.True(onDisk.AsSpan().IndexOf(Encoding.ASCII.GetBytes(Marker)) < 0);
        using var scope = _app.Services.CreateScope();
        var stored = await scope.ServiceProvider.GetRequiredService<MapleDbContext>().Attachments.SingleAsync(a => a.Id == id, Ct);
        Assert.Equal(ContentScheme.EndToEnd, stored.Scheme);
        Assert.Equal((string.Empty, "application/octet-stream"), (stored.FileName, stored.ContentType));
    }

    [Fact]
    public async Task Encrypted_uploads_are_checked_before_they_are_kept()
    {
        var id = Guid.CreateVersion7();
        var metadata = _account.SealMetadata(id, "a.txt", "text/plain", 3);
        var good = _account.EncryptFile(id, Encoding.UTF8.GetBytes(new string('x', 70_000)));

        var noId = await _client.UploadEncryptedAsync(null, metadata, good);
        var version4 = await _client.UploadEncryptedAsync(Guid.NewGuid(), metadata, good);
        var noMetadata = await _client.UploadEncryptedAsync(id, null, good);
        var notEncrypted = await _client.UploadEncryptedAsync(id, metadata, RandomNumberGenerator.GetBytes(5_000));
        // The server can only see that a last chunk is too short to hold its tag; other damage fails decryption.
        var truncated = await _client.UploadEncryptedAsync(id, metadata, good[..(42 + 65_552 + 10)]);
        var plain = await _client.UploadAsync([1, 2, 3], "plain.bin");
        var accepted = await _client.UploadEncryptedAsync(id, metadata, good);
        var duplicate = await _client.UploadEncryptedAsync(id, metadata, good);

        Assert.Contains("id", (await EndToEndAccount.ReadAsync<ValidationProblemDetails>(noId)).Errors.Keys);
        Assert.Contains("id", (await EndToEndAccount.ReadAsync<ValidationProblemDetails>(version4)).Errors.Keys);
        Assert.Contains("metadata", (await EndToEndAccount.ReadAsync<ValidationProblemDetails>(noMetadata)).Errors.Keys);
        Assert.Contains("file", (await EndToEndAccount.ReadAsync<ValidationProblemDetails>(notEncrypted)).Errors.Keys);
        Assert.Contains("file", (await EndToEndAccount.ReadAsync<ValidationProblemDetails>(truncated)).Errors.Keys);
        Assert.Equal(HttpStatusCode.Conflict, plain.StatusCode);
        Assert.Equal(HttpStatusCode.Created, accepted.StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, duplicate.StatusCode);
        Assert.Single(Directory.GetFiles(Path.Combine(_app.DataDirectory, "attachments"), "*", SearchOption.AllDirectories)); // nothing left behind
    }

    [Fact]
    public async Task The_size_limit_allows_for_the_encryption_overhead()
    {
        await _app.DisposeAsync();
        _app = new MapleAppFactory { Settings = { [MapleOptions.MaxUploadMegabytesKey] = "1" } };
        _client = new ApiClient(_app);
        await _client.SignUpAsync("maple");
        _account = await EndToEndAccount.EnableAsync(_client);

        var atLimit = Guid.CreateVersion7();
        var overLimit = Guid.CreateVersion7();
        var fits = await _client.UploadEncryptedAsync(atLimit, _account.SealMetadata(atLimit, "a", "x/y", 1 << 20),
            _account.EncryptFile(atLimit, new byte[1 << 20]));
        var tooBig = await _client.UploadEncryptedAsync(overLimit, _account.SealMetadata(overLimit, "b", "x/y", (1 << 20) + 1),
            _account.EncryptFile(overLimit, new byte[(1 << 20) + 1]));

        Assert.Equal(HttpStatusCode.Created, fits.StatusCode);
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, tooBig.StatusCode);
    }

    [Fact]
    public async Task Accounts_not_in_end_to_end_mode_cannot_upload_ciphertext()
    {
        await using var app = new MapleAppFactory();
        using var client = new ApiClient(app);
        await client.SignUpAsync("plain");
        var id = Guid.CreateVersion7();

        var response = await client.UploadEncryptedAsync(id, _account.SealMetadata(id, "a", "b/c", 1), _account.EncryptFile(id, [1]));

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
    }

    [Fact]
    public async Task Encrypted_files_attach_to_encrypted_notes_and_go_with_them()
    {
        var (fileId, _, _, _) = await UploadAsync(1_000);
        var noteId = Guid.CreateVersion7();

        var created = await EndToEndAccount.ReadAsync<NoteResponse>(await _client.PostJsonAsync("/api/v1/notes",
            new CreateNoteRequest(AttachmentIds: [fileId], Id: noteId, Encrypted: _account.EncryptNote(noteId, "See the photo"))));
        var attachment = Assert.Single(created.Attachments);
        await _client.DeleteAsync($"/api/v1/notes/{noteId}");

        Assert.Equal(fileId, attachment.Id);
        Assert.NotNull(attachment.EncryptedMetadata);
        Assert.Equal(HttpStatusCode.NotFound, (await _client.GetAsync($"/api/v1/attachments/{fileId}")).StatusCode);
        Assert.Empty(Directory.GetFiles(Path.Combine(_app.DataDirectory, "attachments"), "*.bin", SearchOption.AllDirectories));
    }

    private async Task<(Guid Id, byte[] Plaintext, byte[] Ciphertext, AttachmentResponse Response)> UploadAsync(int size)
    {
        var id = Guid.CreateVersion7();
        var plaintext = Encoding.ASCII.GetBytes(string.Concat(Enumerable.Repeat(Marker, (size / Marker.Length) + 1)))[..size];
        var ciphertext = _account.EncryptFile(id, plaintext);
        var response = await _client.UploadEncryptedAsync(id, _account.SealMetadata(id, "holiday Zanzibar.png", "image/png", size), ciphertext);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (id, plaintext, ciphertext, await EndToEndAccount.ReadAsync<AttachmentResponse>(response));
    }
}
