using System.Net;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Security.Cryptography;
using MapleNotes.Server.Domain;
using MapleNotes.Server.Features.Attachments;
using MapleNotes.Server.Features.Auth;
using MapleNotes.Server.Features.Encryption;
using MapleNotes.Server.Features.EndToEnd;
using MapleNotes.Server.Features.Notes;
using MapleNotes.Server.Infrastructure.Persistence;
using MapleNotes.Server.Tests.TestSupport;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

namespace MapleNotes.Server.Tests.E2ee;

/// <summary>
/// End-to-end mode and key management (docs/e2ee-spec.md §3, §6): the server stores only wrapped keys, refuses plain
/// text for end-to-end accounts, and resets passwords with the recovery key without ever seeing the data key.
/// </summary>
public sealed class EndToEndKeyTests : IAsyncLifetime
{
    private readonly MapleAppFactory _app = new();
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
    public async Task Switching_to_end_to_end_stores_only_wrapped_keys()
    {
        var account = await EndToEndAccount.EnableAsync(_client);

        var me = await _client.GetJsonAsync<UserResponse>("/api/v1/auth/me");
        Assert.Equal(EncryptionMode.EndToEnd, me!.EncryptionMode);
        Assert.True(me.HasEndToEndKey);
        Assert.Equal(account.DataKey, await account.UnlockAsync(_client));

        var stored = await StoredUserAsync();
        Assert.Equal(EndToEndKeys.WrappedKeyBytes, stored.E2eeWrappedKey!.Length);
        Assert.False(stored.E2eeWrappedKey.AsSpan().IndexOf(account.DataKey) >= 0);
        Assert.Equal(account.DataKey, E2eeCrypto.Open(
            E2eeCrypto.RecoveryKeys(account.RecoveryKey).WrapKey, stored.E2eeRecoveryWrappedKey!, E2eeCrypto.RecoveryContext(account.UserId)));
        Assert.NotNull(stored.RecoveryKeyHash);
    }

    [Fact]
    public async Task Switching_requires_the_password_and_well_formed_keys()
    {
        var (request, _) = await EndToEndAccount.EnableRequestAsync(_client);

        var wrongPassword = await _client.PostJsonAsync("/api/v1/account/e2ee", request with { Proof = await _client.ProofAsync("not my password") });
        var badKey = await _client.PostJsonAsync("/api/v1/account/e2ee", request with { WrappedKey = new byte[40] });
        var badRecovery = await _client.PostJsonAsync("/api/v1/account/e2ee", request with { RecoveryAuthKey = new byte[8] });

        Assert.Contains("password", (await EndToEndAccount.ReadAsync<ValidationProblemDetails>(wrongPassword)).Errors.Keys);
        Assert.Contains("wrappedKey", (await EndToEndAccount.ReadAsync<ValidationProblemDetails>(badKey)).Errors.Keys);
        Assert.Contains("recoveryAuthKey", (await EndToEndAccount.ReadAsync<ValidationProblemDetails>(badRecovery)).Errors.Keys);
        Assert.Equal(EncryptionMode.AtRest, (await StoredUserAsync()).EncryptionMode);
    }

    [Fact]
    public async Task An_account_gets_only_one_end_to_end_key()
    {
        await EndToEndAccount.EnableAsync(_client);

        var (again, _) = await EndToEndAccount.EnableRequestAsync(_client);
        var response = await _client.PostJsonAsync("/api/v1/account/e2ee", again);

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
    }

    [Fact]
    public async Task End_to_end_accounts_cannot_store_plain_text_but_keep_their_older_notes()
    {
        var older = await EndToEndAccount.ReadAsync<NoteResponse>(await _client.PostJsonAsync("/api/v1/notes", new CreateNoteRequest("written before #old")));
        await EndToEndAccount.EnableAsync(_client);

        var create = await _client.PostJsonAsync("/api/v1/notes", new CreateNoteRequest("plain text"));
        var edit = await _client.PutJsonAsync($"/api/v1/notes/{older.Id}", new UpdateNoteRequest("edited in plain text"));
        var upload = await _client.UploadAsync([1, 2, 3], "a.bin");
        var pin = await _client.PatchJsonAsync($"/api/v1/notes/{older.Id}", new PatchNoteRequest(IsPinned: true));

        Assert.Equal(HttpStatusCode.Conflict, create.StatusCode);
        Assert.Equal("This account uses end-to-end encryption.", (await EndToEndAccount.ReadAsync<ProblemDetails>(create)).Title);
        Assert.Equal(HttpStatusCode.Conflict, edit.StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, upload.StatusCode);
        Assert.Equal(HttpStatusCode.OK, pin.StatusCode);
        var list = await _client.GetJsonAsync<NotePageResponse>("/api/v1/notes?state=active");
        Assert.Equal("written before #old", Assert.Single(list!.Items).Content);
        Assert.Equal(HttpStatusCode.NoContent, (await _client.DeleteAsync($"/api/v1/notes/{older.Id}")).StatusCode);
    }

    [Fact]
    public async Task The_background_worker_leaves_end_to_end_accounts_alone()
    {
        await _client.PostJsonAsync("/api/v1/notes", new CreateNoteRequest("server-encrypted"));
        await EndToEndAccount.EnableAsync(_client);

        using var scope = _app.Services.CreateScope();
        var migrator = scope.ServiceProvider.GetRequiredService<EncryptionMigrator>();
        var pending = await migrator.FindPendingUsersAsync(Ct);
        var run = await migrator.MigrateUserAsync((await StoredUserAsync()).Id, Ct);

        Assert.Empty(pending);
        Assert.Equal(new MigrationRunResult(0, Completed: true), run);
        var status = await _client.GetJsonAsync<EncryptionStatusResponse>("/api/v1/account/encryption");
        Assert.Equal(new EncryptionStatusResponse(EncryptionMode.EndToEnd, InProgress: true, TotalItems: 1, RemainingItems: 1), status);
    }

    [Fact]
    public async Task End_to_end_mode_starts_with_its_own_setup_and_an_empty_account_can_leave_at_once()
    {
        var toEndToEnd = await _client.PutJsonAsync("/api/v1/account/encryption",
            new UpdateEncryptionRequest(EncryptionMode.EndToEnd, await _client.ProofAsync()));
        await EndToEndAccount.EnableAsync(_client);
        var leave = await _client.PutJsonAsync("/api/v1/account/encryption",
            new UpdateEncryptionRequest(EncryptionMode.Off, await _client.ProofAsync()));

        Assert.Contains("mode", (await EndToEndAccount.ReadAsync<ValidationProblemDetails>(toEndToEnd)).Errors.Keys);
        Assert.Equal(HttpStatusCode.OK, leave.StatusCode);
        var user = await StoredUserAsync();
        Assert.Equal(EncryptionMode.Off, user.EncryptionMode);
        Assert.Null(user.E2eeWrappedKey); // nothing was encrypted end-to-end, so nothing needs the key
    }

    [Fact]
    public async Task Changing_the_password_rewraps_the_end_to_end_key()
    {
        var account = await EndToEndAccount.EnableAsync(_client);
        var newKdf = ApiClient.TestKdf("a brand new passphrase");
        var request = new ChangePasswordRequest(
            await _client.ProofAsync(), newKdf, ApiClient.DeriveKeys("a brand new passphrase", newKdf).AuthKey);

        var withoutKey = await _client.PutJsonAsync("/api/v1/auth/password", request);
        var withKey = await _client.PutJsonAsync("/api/v1/auth/password", request with
        {
            Current = await _client.ProofAsync(),
            NewWrappedKey = account.WrapFor("a brand new passphrase", newKdf),
        });

        Assert.Contains("newWrappedKey", (await EndToEndAccount.ReadAsync<ValidationProblemDetails>(withoutKey)).Errors.Keys);
        Assert.Equal(HttpStatusCode.NoContent, withKey.StatusCode);
        Assert.Equal(account.DataKey, await account.UnlockAsync(_client, "a brand new passphrase"));
    }

    [Fact]
    public async Task Accounts_without_an_end_to_end_key_send_no_wrapped_key()
    {
        var newKdf = ApiClient.TestKdf("a brand new passphrase");
        var request = new ChangePasswordRequest(
            await _client.ProofAsync(), newKdf, ApiClient.DeriveKeys("a brand new passphrase", newKdf).AuthKey, new byte[62]);

        var response = await _client.PutJsonAsync("/api/v1/auth/password", request);

        Assert.Contains("newWrappedKey", (await EndToEndAccount.ReadAsync<ValidationProblemDetails>(response)).Errors.Keys);
        Assert.Equal(HttpStatusCode.NotFound, (await _client.GetAsync("/api/v1/account/e2ee")).StatusCode);
    }

    [Fact]
    public async Task The_recovery_key_resets_the_password_and_keeps_the_notes_readable()
    {
        var account = await EndToEndAccount.EnableAsync(_client);
        using var otherDevice = new ApiClient(_app);
        await otherDevice.LoginAsync("maple");
        using var visitor = new ApiClient(_app);
        await visitor.RefreshAntiforgeryTokenAsync();

        // Step 1: prove the recovery key and unwrap the data key with it.
        var (recoveryWrap, recoveryAuth) = E2eeCrypto.RecoveryKeys(account.RecoveryKey);
        var keyResponse = await visitor.PostJsonAsync("/api/v1/auth/recovery/key", new RecoveryKeyRequest("MAPLE", recoveryAuth));
        var recovered = await EndToEndAccount.ReadAsync<RecoveryKeyResponse>(keyResponse);
        var dataKey = E2eeCrypto.Open(recoveryWrap, recovered.RecoveryWrappedKey, E2eeCrypto.RecoveryContext(recovered.UserId));

        // Step 2: a new password and a new recovery key, both wrapping the same data key.
        var newKdf = ApiClient.TestKdf("a brand new passphrase");
        var (newAuth, newWrap) = ApiClient.DeriveKeys("a brand new passphrase", newKdf);
        var newRecoveryKey = RandomNumberGenerator.GetBytes(32);
        var (newRecoveryWrap, newRecoveryAuth) = E2eeCrypto.RecoveryKeys(newRecoveryKey);
        var reset = await visitor.PostJsonAsync("/api/v1/auth/recovery/reset", new ResetWithRecoveryKeyRequest(
            "maple", recoveryAuth, newKdf, newAuth,
            E2eeCrypto.Seal(newWrap, dataKey, E2eeCrypto.DataKeyContext(recovered.UserId)),
            E2eeCrypto.Seal(newRecoveryWrap, dataKey, E2eeCrypto.RecoveryContext(recovered.UserId)),
            newRecoveryAuth));

        Assert.Equal(account.UserId, recovered.UserId);
        Assert.Equal(account.DataKey, dataKey);
        Assert.Equal(HttpStatusCode.OK, reset.StatusCode);
        await visitor.RefreshAntiforgeryTokenAsync();
        Assert.Equal(HttpStatusCode.OK, (await visitor.GetAsync("/api/v1/auth/me")).StatusCode);          // signed in
        Assert.Equal(HttpStatusCode.Unauthorized, (await otherDevice.GetAsync("/api/v1/auth/me")).StatusCode); // others out

        using var later = new ApiClient(_app);
        Assert.Equal(HttpStatusCode.Unauthorized, (await later.LoginAsync("maple")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await later.LoginAsync("maple", "a brand new passphrase")).StatusCode);
        Assert.Equal(account.DataKey, await account.UnlockAsync(later, "a brand new passphrase"));

        var oldRecovery = await visitor.PostJsonAsync("/api/v1/auth/recovery/key", new RecoveryKeyRequest("maple", recoveryAuth));
        var newRecovery = await visitor.PostJsonAsync("/api/v1/auth/recovery/key", new RecoveryKeyRequest("maple", newRecoveryAuth));
        Assert.Equal(HttpStatusCode.Unauthorized, oldRecovery.StatusCode); // a recovery key works once
        Assert.Equal(HttpStatusCode.OK, newRecovery.StatusCode);
    }

    [Fact]
    public async Task Recovery_answers_the_same_for_unknown_users_accounts_without_a_key_and_wrong_keys()
    {
        using var other = new ApiClient(_app);
        await EndToEndAccount.EnableAsync(_client);
        await other.RefreshAntiforgeryTokenAsync();
        var randomKey = E2eeCrypto.RecoveryKeys(RandomNumberGenerator.GetBytes(32)).AuthKey;

        var wrongKey = await other.PostJsonAsync("/api/v1/auth/recovery/key", new RecoveryKeyRequest("maple", randomKey));
        var unknown = await other.PostJsonAsync("/api/v1/auth/recovery/key", new RecoveryKeyRequest("nobody", randomKey));
        await using var plainApp = new MapleAppFactory();
        using var plain = new ApiClient(plainApp);
        await plain.SignUpAsync("plain");
        var noKey = await plain.PostJsonAsync("/api/v1/auth/recovery/key", new RecoveryKeyRequest("plain", randomKey));

        foreach (var response in new[] { wrongKey, unknown, noKey })
        {
            Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
            Assert.Equal("Incorrect username or recovery key.", (await EndToEndAccount.ReadAsync<ProblemDetails>(response)).Title);
        }
    }

    [Fact]
    public async Task Replacing_the_recovery_key_retires_the_old_one()
    {
        var account = await EndToEndAccount.EnableAsync(_client);
        var newRecoveryKey = RandomNumberGenerator.GetBytes(32);
        var (newWrap, newAuth) = E2eeCrypto.RecoveryKeys(newRecoveryKey);

        var replace = await _client.PutJsonAsync("/api/v1/account/e2ee/recovery", new ReplaceRecoveryKeyRequest(
            await _client.ProofAsync(), E2eeCrypto.Seal(newWrap, account.DataKey, E2eeCrypto.RecoveryContext(account.UserId)), newAuth));

        Assert.Equal(HttpStatusCode.NoContent, replace.StatusCode);
        var old = await _client.PostJsonAsync("/api/v1/auth/recovery/key",
            new RecoveryKeyRequest("maple", E2eeCrypto.RecoveryKeys(account.RecoveryKey).AuthKey));
        var current = await _client.PostJsonAsync("/api/v1/auth/recovery/key", new RecoveryKeyRequest("maple", newAuth));
        Assert.Equal(HttpStatusCode.Unauthorized, old.StatusCode);
        Assert.Equal(HttpStatusCode.OK, current.StatusCode);
    }

    [Fact]
    public async Task The_session_key_belongs_to_one_session_and_is_never_cached()
    {
        var first = await _client.GetAsync("/api/v1/auth/session-key");
        var again = await EndToEndAccount.ReadAsync<SessionKeyResponse>(await _client.GetAsync("/api/v1/auth/session-key"));
        (await _client.ChangePasswordAsync(ApiClient.DefaultPassword, "a brand new passphrase")).EnsureSuccessStatusCode();
        var afterPasswordChange = await EndToEndAccount.ReadAsync<SessionKeyResponse>(await _client.GetAsync("/api/v1/auth/session-key"));
        using var other = new ApiClient(_app);
        await other.LoginAsync("maple", "a brand new passphrase");
        var otherSession = await EndToEndAccount.ReadAsync<SessionKeyResponse>(await other.GetAsync("/api/v1/auth/session-key"));
        await other.PostAsync("/api/v1/auth/logout");

        var key = await EndToEndAccount.ReadAsync<SessionKeyResponse>(first);
        Assert.Equal(32, key.Key.Length);
        Assert.Contains("no-store", first.Headers.CacheControl?.ToString(), StringComparison.Ordinal);
        Assert.Equal(key.Key, again.Key);
        Assert.Equal(key.Key, afterPasswordChange.Key); // same session, re-issued cookie
        Assert.NotEqual(key.Key, otherSession.Key);
        Assert.Equal(HttpStatusCode.Unauthorized, (await other.GetAsync("/api/v1/auth/session-key")).StatusCode);
    }

    [Fact]
    public async Task A_session_from_before_1_1_gets_a_session_key()
    {
        var user = await StoredUserAsync();
        var cookieOptions = _app.Services.GetRequiredService<IOptionsMonitor<CookieAuthenticationOptions>>()
            .Get(CookieAuthenticationDefaults.AuthenticationScheme);
        var oldPrincipal = new ClaimsPrincipal(new ClaimsIdentity(
            [
                new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()),
                new Claim(ClaimTypes.Name, user.Username),
                new Claim(ClaimTypes.Role, user.Role.ToString()),
                new Claim(UserPrincipal.SecurityStampClaim, user.SecurityStamp),
            ],
            CookieAuthenticationDefaults.AuthenticationScheme));
        var cookie = cookieOptions.TicketDataFormat.Protect(
            new AuthenticationTicket(oldPrincipal, new AuthenticationProperties(), CookieAuthenticationDefaults.AuthenticationScheme));
        using var http = _app.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = false });
        http.DefaultRequestHeaders.Add("Cookie", $"{cookieOptions.Cookie.Name}={cookie}");

        var response = await http.GetAsync("/api/v1/auth/session-key", Ct);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(32, (await EndToEndAccount.ReadAsync<SessionKeyResponse>(response)).Key.Length);
        Assert.Contains(response.Headers.GetValues("Set-Cookie"), c => c.StartsWith($"{cookieOptions.Cookie.Name}=", StringComparison.Ordinal));
    }

    private async Task<User> StoredUserAsync()
    {
        using var scope = _app.Services.CreateScope();
        return await scope.ServiceProvider.GetRequiredService<MapleDbContext>().Users.AsNoTracking().SingleAsync(u => u.Username == "maple", Ct);
    }
}
