using System.Data.Common;
using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using MapleNotes.Server.Domain;
using MapleNotes.Server.Features.Attachments;
using MapleNotes.Server.Features.Auth;
using MapleNotes.Server.Features.Encryption;
using MapleNotes.Server.Features.Notes;
using MapleNotes.Server.Infrastructure.Crypto;
using MapleNotes.Server.Infrastructure.Persistence;
using MapleNotes.Server.Infrastructure.Storage;
using MapleNotes.Server.Tests.TestSupport;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;

namespace MapleNotes.Server.Tests.Encryption;

public sealed class EncryptionToggleTests : IAsyncLifetime
{
    private readonly MapleAppFactory _app = new() { RunEncryptionWorker = false };
    private ApiClient _client = null!;
    private UserResponse _user = null!;

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    public async ValueTask InitializeAsync()
    {
        _client = new ApiClient(_app);
        _user = await _client.SignUpAsync("maple");
    }

    [Fact]
    public async Task Changing_the_setting_requires_the_password()
    {
        var response = await _client.PutJsonAsync("/api/v1/account/encryption", new UpdateEncryptionRequest(EncryptionMode.Off, await _client.ProofAsync("not my password")));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("password", (await response.Content.ReadFromJsonAsync<ValidationProblemDetails>(ApiClient.Json, Ct))!.Errors.Keys);
        Assert.Equal(EncryptionMode.AtRest, (await StatusAsync()).Mode);
    }

    [Fact]
    public async Task Turning_encryption_off_converts_existing_notes_and_files_while_everything_stays_readable()
    {
        var (notes, file, fileContent) = await CreateContentAsync();

        var status = await SetEncryptionAsync(false);
        var afterToggle = await CreateNoteAsync("written after switching off");
        var feedWhileMixed = await ListActiveAsync();

        Assert.Equal(EncryptionMode.Off, status.Mode);
        Assert.True(status.InProgress);
        Assert.Equal(notes.Count + 1, status.RemainingItems); // the notes plus the attachment
        Assert.Equal(ContentScheme.None, (await StoredNoteAsync(afterToggle.Id)).Scheme); // new content follows the setting at once
        Assert.Equal(notes.Count + 1, feedWhileMixed.Count);          // mixed encrypted/plain content all readable

        var result = await MigrateAsync();

        Assert.True(result.Completed);
        var done = await StatusAsync();
        Assert.False(done.InProgress);
        Assert.Equal(0, done.RemainingItems);
        foreach (var note in notes)
        {
            var stored = await StoredNoteAsync(note.Id);
            Assert.Equal(ContentScheme.None, stored.Scheme);
            Assert.Equal(note.Content, Encoding.UTF8.GetString(stored.Content));
        }

        var storedFile = await StoredAttachmentAsync(file.Id);
        Assert.Equal(ContentScheme.None, storedFile.Scheme);
        Assert.Equal(fileContent, await File.ReadAllBytesAsync(StoredPath(storedFile.StorageKey), Ct));
        Assert.Equal(fileContent, await _client.Http.GetByteArrayAsync(file.Url, Ct));
        Assert.Single(AllStoredFiles()); // the encrypted original was removed
    }

    [Fact]
    public async Task Turning_encryption_back_on_encrypts_everything_again()
    {
        var (notes, file, fileContent) = await CreateContentAsync();
        await SetEncryptionAsync(false);
        await MigrateAsync();

        await SetEncryptionAsync(true);
        await MigrateAsync();

        foreach (var note in notes)
        {
            Assert.Equal(ContentScheme.Server, (await StoredNoteAsync(note.Id)).Scheme);
        }

        var storedFile = await StoredAttachmentAsync(file.Id);
        Assert.Equal(ContentScheme.Server, storedFile.Scheme);
        Assert.True(AttachmentCipher.HasEncryptedHeader(await File.ReadAllBytesAsync(StoredPath(storedFile.StorageKey), Ct)));
        Assert.Equal(fileContent, await _client.Http.GetByteArrayAsync(file.Url, Ct));
        Assert.Equal(notes.Select(n => n.Content).Order(), (await ListActiveAsync()).Select(n => n.Content).Order());
    }

    [Fact]
    public async Task Crash_after_writing_a_converted_file_keeps_the_attachment_readable_and_the_next_run_finishes()
    {
        var (_, file, fileContent) = await CreateContentAsync();
        var originalKey = (await StoredAttachmentAsync(file.Id)).StorageKey;
        await SetEncryptionAsync(false);

        await Assert.ThrowsAsync<IOException>(() => MigrateAsync(migrator =>
            migrator.AfterConvertedFileWritten = _ => throw new IOException("simulated power loss")));

        // The database still points at the original, which still downloads correctly; the new copy is a stray file.
        var afterCrash = await StoredAttachmentAsync(file.Id);
        Assert.Equal(ContentScheme.Server, afterCrash.Scheme);
        Assert.Equal(originalKey, afterCrash.StorageKey);
        Assert.Equal(fileContent, await _client.Http.GetByteArrayAsync(file.Url, Ct));
        Assert.Equal(2, AllStoredFiles().Count);

        var rerun = await MigrateAsync();

        Assert.True(rerun.Completed);
        Assert.Equal(ContentScheme.None, (await StoredAttachmentAsync(file.Id)).Scheme);
        Assert.Equal(fileContent, await _client.Http.GetByteArrayAsync(file.Url, Ct));

        // The stray copy from the crash is an orphan and is removed by the regular cleanup.
        using var scope = _app.Services.CreateScope();
        var cleanup = new AttachmentCleanup(
            scope.ServiceProvider.GetRequiredService<MapleDbContext>(),
            scope.ServiceProvider.GetRequiredService<AttachmentStore>(),
            new ManualTimeProvider(DateTimeOffset.UtcNow.AddHours(2)));
        var removed = await cleanup.RunAsync(Ct);
        Assert.Equal(1, removed.OrphanFiles);
        Assert.Single(AllStoredFiles());
    }

    [Fact]
    public async Task Crash_during_a_note_batch_rolls_the_whole_batch_back()
    {
        var (notes, _, _) = await CreateContentAsync();
        await SetEncryptionAsync(false);

        var crash = await Assert.ThrowsAnyAsync<Exception>(() => MigrateAsync(crashAfterFirstNoteUpdate: true));
        Assert.Contains("simulated crash mid-transaction", crash.ToString(), StringComparison.Ordinal);

        foreach (var note in notes)
        {
            Assert.Equal(ContentScheme.Server, (await StoredNoteAsync(note.Id)).Scheme); // nothing half-converted
        }

        Assert.Equal(notes.Select(n => n.Content).Order(), (await ListActiveAsync()).Select(n => n.Content).Order());

        var rerun = await MigrateAsync();
        Assert.True(rerun.Completed);
        Assert.Equal(0, (await StatusAsync()).RemainingItems);
    }

    [Fact]
    public async Task An_edit_made_while_a_note_is_being_converted_is_not_lost()
    {
        var note = await CreateNoteAsync("first draft");
        await SetEncryptionAsync(false);

        var interrupted = await MigrateAsync(migrator => migrator.BeforeNoteBatchSaved = async () =>
            (await _client.PutJsonAsync($"/api/v1/notes/{note.Id}", new UpdateNoteRequest("edited during conversion"))).EnsureSuccessStatusCode());

        Assert.False(interrupted.Completed);
        var stored = await StoredNoteAsync(note.Id);
        Assert.Equal("edited during conversion", Encoding.UTF8.GetString(stored.Content));
        Assert.Equal(ContentScheme.None, stored.Scheme); // saved by the edit under the new setting
        Assert.True((await MigrateAsync()).Completed);
    }

    [Fact]
    public async Task Background_worker_converts_content_after_the_setting_changes()
    {
        await using var app = new MapleAppFactory();
        using var client = new ApiClient(app);
        await client.SignUpAsync("worker");
        for (var i = 0; i < 5; i++)
        {
            (await client.PostJsonAsync("/api/v1/notes", new CreateNoteRequest($"note {i}"))).EnsureSuccessStatusCode();
        }

        (await client.PutJsonAsync("/api/v1/account/encryption", new UpdateEncryptionRequest(EncryptionMode.Off, await client.ProofAsync()))).EnsureSuccessStatusCode();

        EncryptionStatusResponse? status = null;
        for (var attempt = 0; attempt < 100; attempt++)
        {
            status = await client.GetJsonAsync<EncryptionStatusResponse>("/api/v1/account/encryption");
            if (!status!.InProgress)
            {
                break;
            }

            await Task.Delay(100, Ct);
        }

        Assert.False(status!.InProgress);
        Assert.Equal(5, status.TotalItems);
    }

    public async ValueTask DisposeAsync()
    {
        _client.Dispose();
        await _app.DisposeAsync();
    }

    private async Task<(List<NoteResponse> Notes, AttachmentResponse File, byte[] Content)> CreateContentAsync()
    {
        var content = RandomNumberGenerator.GetBytes(150_000);
        var upload = await _client.UploadAsync(content, "document.bin");
        var file = (await upload.Content.ReadFromJsonAsync<AttachmentResponse>(ApiClient.Json, Ct))!;

        var notes = new List<NoteResponse>
        {
            await CreateNoteAsync("secret one #diary"),
            await CreateNoteAsync("secret two"),
        };
        var withFile = await _client.PostJsonAsync("/api/v1/notes", new CreateNoteRequest("with attachment", [file.Id]));
        notes.Add((await withFile.Content.ReadFromJsonAsync<NoteResponse>(ApiClient.Json, Ct))!);
        return (notes, file, content);
    }

    private async Task<NoteResponse> CreateNoteAsync(string content)
    {
        var response = await _client.PostJsonAsync("/api/v1/notes", new CreateNoteRequest(content));
        return (await response.Content.ReadFromJsonAsync<NoteResponse>(ApiClient.Json, Ct))!;
    }

    private async Task<EncryptionStatusResponse> SetEncryptionAsync(bool enabled)
    {
        var response = await _client.PutJsonAsync("/api/v1/account/encryption", new UpdateEncryptionRequest(enabled ? EncryptionMode.AtRest : EncryptionMode.Off, await _client.ProofAsync()));
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<EncryptionStatusResponse>(ApiClient.Json, Ct))!;
    }

    private async Task<EncryptionStatusResponse> StatusAsync() =>
        (await _client.GetJsonAsync<EncryptionStatusResponse>("/api/v1/account/encryption"))!;

    private async Task<List<NoteResponse>> ListActiveAsync() =>
        [.. (await _client.GetJsonAsync<NotePageResponse>("/api/v1/notes?state=active&limit=100"))!.Items];

    /// <summary>Runs the migrator for the test user in its own scope, optionally with fault injection.</summary>
    private async Task<MigrationRunResult> MigrateAsync(Action<EncryptionMigrator>? configure = null, bool crashAfterFirstNoteUpdate = false)
    {
        using var scope = _app.Services.CreateScope();
        var services = scope.ServiceProvider;
        var options = new DbContextOptionsBuilder<MapleDbContext>()
            .UseSqlite(services.GetRequiredService<DatabaseConnectionString>().Value);
        if (crashAfterFirstNoteUpdate)
        {
            options.AddInterceptors(new CrashAfterFirstNoteUpdate());
        }

        await using var db = new MapleDbContext(options.Options);
        using var keys = new UserContentKeys(db, services.GetRequiredService<DataKeyService>());
        var migrator = new EncryptionMigrator(db, keys, services.GetRequiredService<AttachmentStore>(), NullLogger<EncryptionMigrator>.Instance);
        configure?.Invoke(migrator);
        return await migrator.MigrateUserAsync(_user.Id, Ct);
    }

    private async Task<Domain.Note> StoredNoteAsync(Guid id)
    {
        using var scope = _app.Services.CreateScope();
        return await scope.ServiceProvider.GetRequiredService<MapleDbContext>().Notes.AsNoTracking().SingleAsync(n => n.Id == id, Ct);
    }

    private async Task<Domain.Attachment> StoredAttachmentAsync(Guid id)
    {
        using var scope = _app.Services.CreateScope();
        return await scope.ServiceProvider.GetRequiredService<MapleDbContext>().Attachments.AsNoTracking().SingleAsync(a => a.Id == id, Ct);
    }

    private string StoredPath(string storageKey) => Path.Combine(_app.DataDirectory, "attachments", storageKey);

    private List<string> AllStoredFiles() =>
        [.. Directory.GetFiles(Path.Combine(_app.DataDirectory, "attachments"), "*.bin", SearchOption.AllDirectories)];

    /// <summary>Simulates a crash after the first note row of a batch has been written inside the transaction.</summary>
    private sealed class CrashAfterFirstNoteUpdate : DbCommandInterceptor
    {
        public override ValueTask<DbDataReader> ReaderExecutedAsync(
            DbCommand command, CommandExecutedEventData eventData, DbDataReader result, CancellationToken cancellationToken = default) =>
            command.CommandText.Contains("UPDATE \"Notes\"", StringComparison.Ordinal)
                ? throw new InvalidOperationException("simulated crash mid-transaction")
                : ValueTask.FromResult(result);

        public override ValueTask<int> NonQueryExecutedAsync(
            DbCommand command, CommandExecutedEventData eventData, int result, CancellationToken cancellationToken = default) =>
            command.CommandText.Contains("UPDATE \"Notes\"", StringComparison.Ordinal)
                ? throw new InvalidOperationException("simulated crash mid-transaction")
                : ValueTask.FromResult(result);
    }
}

public sealed class AccountDeletionTests : IAsyncLifetime
{
    private readonly MapleAppFactory _app = new() { Settings = { ["MAPLE_ALLOW_REGISTRATION"] = "true" } };
    private ApiClient _admin = null!;
    private ApiClient _member = null!;
    private UserResponse _memberUser = null!;

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    public async ValueTask InitializeAsync()
    {
        _admin = new ApiClient(_app);
        _member = new ApiClient(_app);
        await _admin.SignUpAsync("admin");
        _memberUser = await _member.SignUpAsync("member");
    }

    [Fact]
    public async Task Deleting_your_account_removes_notes_files_and_the_data_key()
    {
        var upload = await _member.UploadAsync([1, 2, 3], "a.bin");
        var file = (await upload.Content.ReadFromJsonAsync<AttachmentResponse>(ApiClient.Json, Ct))!;
        await _member.PostJsonAsync("/api/v1/notes", new CreateNoteRequest("goodbye", [file.Id]));
        await _admin.PostJsonAsync("/api/v1/notes", new CreateNoteRequest("admin stays"));

        using var request = new HttpRequestMessage(HttpMethod.Delete, "/api/v1/account")
        {
            Content = JsonContent.Create(new DeleteAccountRequest(await _member.ProofAsync()), options: ApiClient.Json),
        };
        var response = await _member.Http.SendAsync(request, Ct);

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await _member.GetAsync("/api/v1/auth/me")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await _member.LoginAsync("member")).StatusCode);

        using var scope = _app.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<MapleDbContext>();
        Assert.False(await db.Users.AnyAsync(u => u.Id == _memberUser.Id, Ct));
        Assert.False(await db.Notes.AnyAsync(n => n.UserId == _memberUser.Id, Ct));
        Assert.False(await db.Attachments.AnyAsync(a => a.UserId == _memberUser.Id, Ct));
        Assert.Empty(Directory.GetFiles(Path.Combine(_app.DataDirectory, "attachments"), "*.bin", SearchOption.AllDirectories));
        Assert.Single((await _admin.GetJsonAsync<NotePageResponse>("/api/v1/notes"))!.Items);
    }

    [Fact]
    public async Task Deleting_requires_the_password()
    {
        using var request = new HttpRequestMessage(HttpMethod.Delete, "/api/v1/account")
        {
            Content = JsonContent.Create(new DeleteAccountRequest(await _member.ProofAsync("wrong password!")), options: ApiClient.Json),
        };

        var response = await _member.Http.SendAsync(request, Ct);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await _member.GetAsync("/api/v1/auth/me")).StatusCode);
    }

    [Fact]
    public async Task The_only_administrator_cannot_delete_their_account()
    {
        using var request = new HttpRequestMessage(HttpMethod.Delete, "/api/v1/account")
        {
            Content = JsonContent.Create(new DeleteAccountRequest(await _admin.ProofAsync()), options: ApiClient.Json),
        };

        var response = await _admin.Http.SendAsync(request, Ct);

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
    }

    [Fact]
    public async Task Administrators_can_delete_other_accounts_but_not_their_own_this_way()
    {
        var other = await _admin.DeleteAsync($"/api/v1/admin/users/{_memberUser.Id}");
        var self = await _admin.DeleteAsync($"/api/v1/admin/users/{(await _admin.GetJsonAsync<UserResponse>("/api/v1/auth/me"))!.Id}");

        Assert.Equal(HttpStatusCode.NoContent, other.StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, self.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await _member.GetAsync("/api/v1/auth/me")).StatusCode);
    }

    [Fact]
    public async Task Database_connections_use_secure_delete()
    {
        using var scope = _app.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<MapleDbContext>();

        var secureDelete = await db.Database.SqlQueryRaw<long>("SELECT secure_delete AS \"Value\" FROM pragma_secure_delete").SingleAsync(Ct);

        Assert.Equal(1, secureDelete);
    }

    public async ValueTask DisposeAsync()
    {
        _admin.Dispose();
        _member.Dispose();
        await _app.DisposeAsync();
    }
}
