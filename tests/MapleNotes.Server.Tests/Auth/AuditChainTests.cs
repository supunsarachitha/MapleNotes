using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using MapleNotes.Server.Domain;
using MapleNotes.Server.Features.Audit;
using MapleNotes.Server.Features.Auth;
using MapleNotes.Server.Features.Encryption;
using MapleNotes.Server.Features.EndToEnd;
using MapleNotes.Server.Features.Passkeys;
using MapleNotes.Server.Infrastructure.Configuration;
using MapleNotes.Server.Infrastructure.Persistence;
using MapleNotes.Server.Tests.TestSupport;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace MapleNotes.Server.Tests.Auth;

/// <summary>People's own security changes in the audit log, the hash chain over entries, and the stdout copy.</summary>
public sealed class AuditChainTests : IAsyncLifetime
{
    private readonly ManualTimeProvider _clock = new(DateTimeOffset.UtcNow);
    private readonly CapturedStdout _stdout = new();
    private readonly MapleAppFactory _app;
    private ApiClient _admin = null!;
    private ApiClient _member = null!;

    public AuditChainTests()
    {
        _app = new MapleAppFactory { Settings = { [MapleOptions.AllowRegistrationKey] = "true", [MapleOptions.AuditStdoutKey] = "true" } };
        _app.ConfigureTestServices = services =>
        {
            services.AddSingleton<TimeProvider>(_clock);
            services.AddSingleton<AuditStdout>(_stdout);
        };
    }

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

    private async Task<IReadOnlyList<AuditEntryResponse>> SecurityEntriesAsync() =>
        (await _admin.GetJsonAsync<AuditPageResponse>("/api/v1/admin/audit?filter=Security"))!.Items;

    private Task<AuditVerifyResponse?> VerifyAsync() => _admin.GetJsonAsync<AuditVerifyResponse>("/api/v1/admin/audit/verify");

    private async Task<T> WithDbAsync<T>(Func<MapleDbContext, Task<T>> action)
    {
        using var scope = _app.Services.CreateScope();
        return await action(scope.ServiceProvider.GetRequiredService<MapleDbContext>());
    }

    private string CurrentCode(string secret) => Totp.Code(Totp.FromBase32(secret)!, Totp.StepAt(_clock.GetUtcNow()));

    [Fact]
    public async Task Records_peoples_own_security_changes_without_secrets()
    {
        // Two-factor sign-in on, codes replaced, off.
        var setup = (await (await _member.PostAsync("/api/v1/account/two-factor/setup")).Content.ReadFromJsonAsync<TwoFactorSetupResponse>(ApiClient.Json, Ct))!;
        var enabled = await _member.PostJsonAsync("/api/v1/account/two-factor",
            new EnableTwoFactorRequest(await _member.ProofAsync(), setup.Secret, CurrentCode(setup.Secret)));
        var codes = (await enabled.Content.ReadFromJsonAsync<RecoveryCodesResponse>(ApiClient.Json, Ct))!.Codes;
        await _member.RefreshAntiforgeryTokenAsync();
        _clock.Advance(TimeSpan.FromSeconds(Totp.StepSeconds));
        (await _member.PostJsonAsync("/api/v1/account/two-factor/recovery-codes",
            new TwoFactorConfirmation(await _member.ProofAsync(), CurrentCode(setup.Secret)))).EnsureSuccessStatusCode();
        _clock.Advance(TimeSpan.FromSeconds(Totp.StepSeconds));
        (await _member.DeleteJsonAsync("/api/v1/account/two-factor",
            new TwoFactorConfirmation(await _member.ProofAsync(), CurrentCode(setup.Secret)))).EnsureSuccessStatusCode();

        // A passkey added and removed.
        using var device = new FakeAuthenticator();
        var options = (await (await _member.PostAsync("/api/v1/account/passkeys/options")).Content.ReadFromJsonAsync<PasskeyCreationOptions>(ApiClient.Json, Ct))!;
        var added = await _member.PostJsonAsync("/api/v1/account/passkeys",
            new AddPasskeyRequest(await _member.ProofAsync(), options.ChallengeId, "Laptop", device.Create(options)));
        var passkey = (await added.Content.ReadFromJsonAsync<PasskeyResponse>(ApiClient.Json, Ct))!;
        (await _member.DeleteJsonAsync($"/api/v1/account/passkeys/{passkey.Id}", new RemovePasskeyRequest(await _member.ProofAsync()))).EnsureSuccessStatusCode();

        // The password changed.
        const string newPassword = "a brand new password";
        (await _member.ChangePasswordAsync(ApiClient.DefaultPassword, newPassword)).EnsureSuccessStatusCode();
        await _member.RefreshAntiforgeryTokenAsync();

        // Encryption: at rest → off, then end-to-end with a new recovery key; then signed out everywhere.
        (await _member.PutJsonAsync("/api/v1/account/encryption", new UpdateEncryptionRequest(EncryptionMode.Off, await _member.ProofAsync(newPassword)))).EnsureSuccessStatusCode();
        var account = await EndToEndAccount.EnableAsync(_member, newPassword);
        var (newWrap, newAuth) = E2eeCrypto.RecoveryKeys(RandomNumberGenerator.GetBytes(32));
        (await _member.PutJsonAsync("/api/v1/account/e2ee/recovery", new ReplaceRecoveryKeyRequest(
            await _member.ProofAsync(newPassword), E2eeCrypto.Seal(newWrap, account.DataKey, E2eeCrypto.RecoveryContext(account.UserId)), newAuth))).EnsureSuccessStatusCode();
        (await _member.PostAsync("/api/v1/auth/sign-out-everywhere")).EnsureSuccessStatusCode();

        var entries = (await SecurityEntriesAsync()).Reverse().ToList();
        Assert.Equal(
            [
                AuditEvent.TwoFactorEnabled, AuditEvent.RecoveryCodesReplaced, AuditEvent.TwoFactorDisabled,
                AuditEvent.PasskeyAdded, AuditEvent.PasskeyRemoved, AuditEvent.PasswordChanged, AuditEvent.EncryptionChanged,
                AuditEvent.EncryptionChanged, AuditEvent.RecoveryKeyReplaced, AuditEvent.SignedOutEverywhere,
            ],
            entries.Select(e => e.Event));
        Assert.All(entries, e => Assert.Equal("member", e.Username));
        Assert.Equal("Added the passkey \"Laptop\".", entries[3].Detail);
        Assert.Equal("Removed the passkey \"Laptop\".", entries[4].Detail);
        Assert.Equal("Encryption: at rest → off.", entries[6].Detail);
        Assert.Equal("Turned on end-to-end encryption.", entries[7].Detail);

        // Neither the security filter nor the administrators' one mixes the two up.
        Assert.Empty((await _admin.GetJsonAsync<AuditPageResponse>("/api/v1/admin/audit?filter=Admin"))!.Items);
        var everything = string.Join("\n", entries.Select(e => e.Detail));
        Assert.DoesNotContain(setup.Secret, everything);
        Assert.All(codes, code => Assert.DoesNotContain(code, everything));
        Assert.True((await VerifyAsync())!.Intact);
    }

    [Fact]
    public async Task An_intact_chain_verifies_and_an_edited_entry_is_named()
    {
        for (var i = 0; i < 3; i++)
        {
            await new ApiClient(_app).LoginAsync("member", "wrong password");
        }

        var intact = (await VerifyAsync())!;
        Assert.True(intact.Intact);
        Assert.Equal(3, intact.CheckedEntries);
        Assert.Null(intact.FirstBrokenId);

        var middle = await WithDbAsync(db => db.AuditEntries.OrderBy(e => e.Id).Skip(1).Select(e => e.Id).FirstAsync(Ct));
        await WithDbAsync(db => db.AuditEntries.Where(e => e.Id == middle).ExecuteUpdateAsync(e => e.SetProperty(x => x.Username, "someone else"), Ct));

        var edited = (await VerifyAsync())!;
        Assert.False(edited.Intact);
        Assert.Equal(middle, edited.FirstBrokenId);
        Assert.Equal(1, edited.CheckedEntries);
    }

    [Fact]
    public async Task A_deleted_entry_breaks_the_link_of_the_next_one()
    {
        for (var i = 0; i < 3; i++)
        {
            await new ApiClient(_app).LoginAsync("member", "wrong password");
        }

        var ids = await WithDbAsync(db => db.AuditEntries.OrderBy(e => e.Id).Select(e => e.Id).ToListAsync(Ct));
        await WithDbAsync(db => db.AuditEntries.Where(e => e.Id == ids[1]).ExecuteDeleteAsync(Ct));

        var result = (await VerifyAsync())!;
        Assert.False(result.Intact);
        Assert.Equal(ids[2], result.FirstBrokenId);

        // Deleting the oldest one breaks the chain too: it no longer starts at the anchor.
        await using var other = new MapleAppFactory();
        using (var scope = other.Services.CreateScope())
        {
            var audit = scope.ServiceProvider.GetRequiredService<AuditLog>();
            await audit.RecordAsync(AuditEvent.SignIn, "a", "First.", Ct);
            await audit.RecordAsync(AuditEvent.SignIn, "b", "Second.", Ct);
            var db = scope.ServiceProvider.GetRequiredService<MapleDbContext>();
            var first = await db.AuditEntries.MinAsync(e => e.Id, Ct);
            await db.AuditEntries.Where(e => e.Id == first).ExecuteDeleteAsync(Ct);
            Assert.False((await audit.VerifyAsync(Ct)).Intact);
        }
    }

    [Fact]
    public async Task Pruning_keeps_the_chain_verifiable_and_a_moved_anchor_is_caught()
    {
        await new ApiClient(_app).LoginAsync("member", "wrong password");
        await new ApiClient(_app).LoginAsync("member", "wrong password");
        _clock.Advance(TimeSpan.FromDays(AuditEntry.RetentionDays + 1));
        await new ApiClient(_app).LoginAsync("member", "wrong password");

        using (var scope = _app.Services.CreateScope())
        {
            Assert.Equal(2, await scope.ServiceProvider.GetRequiredService<AuditLog>().PruneAsync(Ct));
        }

        await _admin.LoginAsync("admin"); // the old session has outlived its 90 days

        var afterPrune = (await VerifyAsync())!;
        Assert.True(afterPrune.Intact);
        Assert.Equal(2, afterPrune.CheckedEntries); // the refused sign-in and the administrator's new one
        Assert.True(afterPrune.PrunedThroughId > 0);

        // Someone who deletes the oldest kept entry and moves the anchor past it cannot seal the anchor again.
        var oldest = await WithDbAsync(db => db.AuditEntries.OrderBy(e => e.Id).FirstAsync(Ct));
        await WithDbAsync(db => db.AuditEntries.Where(e => e.Id == oldest.Id).ExecuteDeleteAsync(Ct));
        await WithDbAsync(db => db.AuditChainAnchors.ExecuteUpdateAsync(
            a => a.SetProperty(x => x.PrunedThroughId, oldest.Id).SetProperty(x => x.Hash, oldest.Hash!), Ct));
        var moved = (await VerifyAsync())!;
        Assert.False(moved.Intact);
        Assert.Contains("start of the chain", moved.Problem);
    }

    [Fact]
    public async Task Entries_from_before_the_chain_are_counted_but_not_vouched_for()
    {
        await using var app = new MapleAppFactory();
        using var scope = app.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<MapleDbContext>();
        db.AuditEntries.Add(new AuditEntry { AtUtc = DateTime.UtcNow, Event = AuditEvent.SignIn, Username = "old", Detail = "Before 1.22." });
        await db.SaveChangesAsync(Ct);

        var audit = scope.ServiceProvider.GetRequiredService<AuditLog>();
        await audit.RecordAsync(AuditEvent.SignIn, "new", "After the upgrade.", Ct);

        var result = await audit.VerifyAsync(Ct);
        Assert.True(result.Intact);
        Assert.Equal((1, 1), (result.CheckedEntries, result.UncoveredEntries));

        // A hash removed after the chain started is not mistaken for an old entry.
        await db.AuditEntries.Where(e => e.Username == "new").ExecuteUpdateAsync(e => e.SetProperty(x => x.Hash, (byte[]?)null), Ct);
        Assert.False((await audit.VerifyAsync(Ct)).Intact);
    }

    [Fact]
    public async Task Entries_go_to_stdout_as_json_lines_when_asked()
    {
        await new ApiClient(_app).LoginAsync("member", "wrong password");

        var line = _stdout.Lines.Last();
        using var json = JsonDocument.Parse(line);
        Assert.Equal("maple-audit", json.RootElement.GetProperty("type").GetString());
        Assert.Equal("SignInFailed", json.RootElement.GetProperty("event").GetString());
        Assert.Equal("member", json.RootElement.GetProperty("username").GetString());
        var stored = await WithDbAsync(db => db.AuditEntries.OrderByDescending(e => e.Id).FirstAsync(Ct));
        Assert.Equal(Convert.ToBase64String(stored.Hash!), json.RootElement.GetProperty("hash").GetString());

        await using var quiet = new MapleAppFactory();
        var quietOut = new CapturedStdout();
        quiet.ConfigureTestServices = services => services.AddSingleton<AuditStdout>(quietOut);
        using (var scope = quiet.Services.CreateScope())
        {
            await scope.ServiceProvider.GetRequiredService<AuditLog>().RecordAsync(AuditEvent.SignIn, "x", "Off by default.", Ct);
        }

        Assert.Empty(quietOut.Lines);
    }

    [Fact]
    public async Task Only_administrators_can_verify()
    {
        Assert.Equal(HttpStatusCode.Forbidden, (await _member.GetAsync("/api/v1/admin/audit/verify")).StatusCode);
    }

    /// <summary>Collects what the audit log would print.</summary>
    private sealed class CapturedStdout : AuditStdout
    {
        private readonly StringWriter _writer = new();

        public override TextWriter Writer => _writer;

        public IReadOnlyList<string> Lines => _writer.ToString().Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
    }
}
