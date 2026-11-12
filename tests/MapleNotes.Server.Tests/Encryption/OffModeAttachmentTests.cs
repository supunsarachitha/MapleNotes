using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using MapleNotes.Server.Domain;
using MapleNotes.Server.Features.Attachments;
using MapleNotes.Server.Features.Auth;
using MapleNotes.Server.Features.Encryption;
using MapleNotes.Server.Infrastructure.Crypto;
using MapleNotes.Server.Infrastructure.Persistence;
using MapleNotes.Server.Infrastructure.Storage;
using MapleNotes.Server.Tests.TestSupport;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;

namespace MapleNotes.Server.Tests.Encryption;

/// <summary>
/// Accounts with encryption "Off" keep their notes in the encrypted database only, but attachment files live outside
/// it, so the server encrypts them with an instance key derived from the master key. A copy of the disk without the
/// master key then reveals no file in any mode.
/// </summary>
public sealed class OffModeAttachmentTests : IAsyncLifetime
{
    private readonly MapleAppFactory _app = new() { RunEncryptionWorker = false };
    private ApiClient _client = null!;
    private UserResponse _user = null!;

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    public async ValueTask InitializeAsync()
    {
        _client = new ApiClient(_app);
        _user = await _client.SignUpAsync("maple");
        var response = await _client.PutJsonAsync("/api/v1/account/encryption", new UpdateEncryptionRequest(EncryptionMode.Off, await _client.ProofAsync()));
        response.EnsureSuccessStatusCode();
    }

    public async ValueTask DisposeAsync() => await _app.DisposeAsync();

    [Fact]
    public async Task Upload_in_off_mode_is_encrypted_on_disk_with_the_instance_key_and_downloads_intact()
    {
        var content = RandomNumberGenerator.GetBytes(200_000);

        var file = await UploadAsync(content);

        var stored = await StoredAttachmentAsync(file.Id);
        Assert.Equal(ContentScheme.Instance, stored.Scheme);
        var onDisk = await File.ReadAllBytesAsync(StoredPath(stored.StorageKey), Ct);
        Assert.True(AttachmentCipher.HasEncryptedHeader(onDisk));
        Assert.Equal(-1, onDisk.AsSpan().IndexOf(content.AsSpan(0, 64)));
        Assert.Equal(content, await _client.Http.GetByteArrayAsync(file.Url, Ct));
    }

    [Fact]
    public async Task Range_requests_work_on_instance_encrypted_files()
    {
        var content = RandomNumberGenerator.GetBytes(300_000);
        var file = await UploadAsync(content, "video.mp4", "video/mp4");

        using var request = new HttpRequestMessage(HttpMethod.Get, file.Url);
        request.Headers.Range = new RangeHeaderValue(65_500, 65_600); // spans the first 64 KiB chunk boundary
        var response = await _client.Http.SendAsync(request, Ct);

        Assert.Equal(HttpStatusCode.PartialContent, response.StatusCode);
        Assert.Equal(content.AsSpan(65_500, 101).ToArray(), await response.Content.ReadAsByteArrayAsync(Ct));
        Assert.Equal(300_000, response.Content.Headers.ContentRange!.Length);
    }

    [Fact]
    public async Task Plaintext_files_from_before_the_upgrade_are_found_and_encrypted_by_the_migration()
    {
        var content = RandomNumberGenerator.GetBytes(150_000);
        var legacy = await AddLegacyPlaintextFileAsync(_user.Id, content);
        Assert.True((await StatusAsync()).InProgress); // counted as not yet converted

        using (var scope = _app.Services.CreateScope())
        {
            var pending = await scope.ServiceProvider.GetRequiredService<EncryptionMigrator>().FindPendingUsersAsync(Ct);
            Assert.Contains(_user.Id, pending);
        }

        var result = await MigrateAsync();

        Assert.True(result.Completed);
        var stored = await StoredAttachmentAsync(legacy.Id);
        Assert.Equal(ContentScheme.Instance, stored.Scheme);
        Assert.True(AttachmentCipher.HasEncryptedHeader(await File.ReadAllBytesAsync(StoredPath(stored.StorageKey), Ct)));
        Assert.Equal(content, await _client.Http.GetByteArrayAsync($"/api/v1/attachments/{legacy.Id}", Ct));
        Assert.Single(AllStoredFiles()); // the plaintext original is gone
        Assert.False((await StatusAsync()).InProgress);
    }

    [Fact]
    public async Task An_interrupted_migration_leaves_the_plaintext_file_readable_and_the_next_run_finishes()
    {
        var content = RandomNumberGenerator.GetBytes(10_000);
        var legacy = await AddLegacyPlaintextFileAsync(_user.Id, content);

        await Assert.ThrowsAsync<IOException>(() => MigrateAsync(migrator =>
            migrator.AfterConvertedFileWritten = _ => throw new IOException("simulated power loss")));

        var afterCrash = await StoredAttachmentAsync(legacy.Id);
        Assert.Equal(ContentScheme.None, afterCrash.Scheme);
        Assert.Equal(legacy.StorageKey, afterCrash.StorageKey);
        Assert.Equal(content, await _client.Http.GetByteArrayAsync($"/api/v1/attachments/{legacy.Id}", Ct));

        var rerun = await MigrateAsync();

        Assert.True(rerun.Completed);
        Assert.Equal(ContentScheme.Instance, (await StoredAttachmentAsync(legacy.Id)).Scheme);
        Assert.Equal(content, await _client.Http.GetByteArrayAsync($"/api/v1/attachments/{legacy.Id}", Ct));
    }

    [Fact]
    public async Task Switching_between_off_and_at_rest_re_encrypts_files_with_the_matching_key()
    {
        var content = RandomNumberGenerator.GetBytes(70_000);
        var file = await UploadAsync(content);

        await SetModeAsync(EncryptionMode.AtRest);
        await MigrateAsync();
        Assert.Equal(ContentScheme.Server, (await StoredAttachmentAsync(file.Id)).Scheme);
        Assert.Equal(content, await _client.Http.GetByteArrayAsync(file.Url, Ct));

        await SetModeAsync(EncryptionMode.Off);
        await MigrateAsync();
        var stored = await StoredAttachmentAsync(file.Id);
        Assert.Equal(ContentScheme.Instance, stored.Scheme);
        Assert.True(AttachmentCipher.HasEncryptedHeader(await File.ReadAllBytesAsync(StoredPath(stored.StorageKey), Ct)));
        Assert.Equal(content, await _client.Http.GetByteArrayAsync(file.Url, Ct));
        Assert.Single(AllStoredFiles());
    }

    [Fact]
    public async Task End_to_end_accounts_get_leftover_plaintext_files_encrypted_and_nothing_else_touched()
    {
        await SetModeAsync(EncryptionMode.AtRest);
        var serverFile = await UploadAsync(RandomNumberGenerator.GetBytes(2_000));
        var content = RandomNumberGenerator.GetBytes(5_000);
        var legacy = await AddLegacyPlaintextFileAsync(_user.Id, content);
        using (var scope = _app.Services.CreateScope())
        {
            // The browser's conversion has not reached these files yet.
            await scope.ServiceProvider.GetRequiredService<MapleDbContext>().Users.Where(u => u.Id == _user.Id)
                .ExecuteUpdateAsync(u => u.SetProperty(x => x.EncryptionMode, EncryptionMode.EndToEnd), Ct);
        }

        var result = await MigrateAsync();

        Assert.True(result.Completed);
        Assert.Equal(ContentScheme.Instance, (await StoredAttachmentAsync(legacy.Id)).Scheme);
        Assert.Equal(ContentScheme.Server, (await StoredAttachmentAsync(serverFile.Id)).Scheme); // left for the browser
        using var check = _app.Services.CreateScope();
        var attachments = check.ServiceProvider.GetRequiredService<AttachmentService>();
        await using var plain = await attachments.OpenContentAsync(await StoredAttachmentAsync(legacy.Id), Ct);
        using var copy = new MemoryStream();
        await plain.CopyToAsync(copy, Ct);
        Assert.Equal(content, copy.ToArray()); // the browser's conversion still reads it as plaintext
    }

    [Fact]
    public async Task Instance_encrypted_files_are_bound_to_their_owner_and_attachment()
    {
        var file = await UploadAsync(RandomNumberGenerator.GetBytes(1_000));
        var stored = await StoredAttachmentAsync(file.Id);

        using var scope = _app.Services.CreateScope();
        var keys = scope.ServiceProvider.GetRequiredService<UserContentKeys>();
        Assert.ThrowsAny<CryptographicException>(() => ReadWith(Guid.NewGuid(), stored.Id));
        Assert.ThrowsAny<CryptographicException>(() => ReadWith(_user.Id, Guid.NewGuid()));
        Assert.Equal(1_000, ReadWith(_user.Id, stored.Id)); // the right owner and ID decrypt

        int ReadWith(Guid userId, Guid attachmentId)
        {
            using var onDisk = File.OpenRead(StoredPath(stored.StorageKey));
            using var plain = DecryptingAttachmentStream.Open(onDisk, keys.InstanceAttachmentKey, userId, attachmentId);
            using var copy = new MemoryStream();
            plain.CopyTo(copy);
            return (int)copy.Length;
        }
    }

    private async Task<AttachmentResponse> UploadAsync(byte[] content, string name = "data.bin", string type = "application/octet-stream")
    {
        var response = await _client.UploadAsync(content, name, type);
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<AttachmentResponse>(ApiClient.Json, Ct))!;
    }

    /// <summary>Stores a file the way versions before 1.22 did in "Off" mode: plaintext on disk.</summary>
    private async Task<Attachment> AddLegacyPlaintextFileAsync(Guid userId, byte[] content)
    {
        using var scope = _app.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<MapleDbContext>();
        var store = scope.ServiceProvider.GetRequiredService<AttachmentStore>();
        var id = Guid.CreateVersion7();
        var storageKey = AttachmentStore.CreateStorageKey(id);
        await store.WriteAsync(storageKey, (file, ct) => file.WriteAsync(content, ct).AsTask(), cancellationToken: Ct);
        var attachment = new Attachment
        {
            Id = id, UserId = userId, FileName = "old.bin", ContentType = "application/octet-stream", SizeBytes = content.Length,
            StorageKey = storageKey, Scheme = ContentScheme.None, CreatedAtUtc = DateTime.UtcNow,
        };
        db.Attachments.Add(attachment);
        await db.SaveChangesAsync(Ct);
        return attachment;
    }

    private async Task SetModeAsync(EncryptionMode mode)
    {
        var response = await _client.PutJsonAsync("/api/v1/account/encryption", new UpdateEncryptionRequest(mode, await _client.ProofAsync()));
        response.EnsureSuccessStatusCode();
    }

    private async Task<EncryptionStatusResponse> StatusAsync() =>
        (await _client.GetJsonAsync<EncryptionStatusResponse>("/api/v1/account/encryption"))!;

    private async Task<MigrationRunResult> MigrateAsync(Action<EncryptionMigrator>? configure = null)
    {
        using var scope = _app.Services.CreateScope();
        var services = scope.ServiceProvider;
        var db = services.GetRequiredService<MapleDbContext>();
        var migrator = new EncryptionMigrator(db, services.GetRequiredService<UserContentKeys>(), services.GetRequiredService<AttachmentStore>(), NullLogger<EncryptionMigrator>.Instance);
        configure?.Invoke(migrator);
        return await migrator.MigrateUserAsync(_user.Id, Ct);
    }

    private async Task<Attachment> StoredAttachmentAsync(Guid id)
    {
        using var scope = _app.Services.CreateScope();
        return await scope.ServiceProvider.GetRequiredService<MapleDbContext>().Attachments.AsNoTracking().SingleAsync(a => a.Id == id, Ct);
    }

    private string StoredPath(string storageKey) => Path.Combine(_app.DataDirectory, "attachments", storageKey);

    private List<string> AllStoredFiles() =>
        [.. Directory.GetFiles(Path.Combine(_app.DataDirectory, "attachments"), "*.bin", SearchOption.AllDirectories)];
}
