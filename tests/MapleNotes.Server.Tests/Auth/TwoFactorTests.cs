using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using MapleNotes.Server.Features.Admin;
using MapleNotes.Server.Features.Auth;
using MapleNotes.Server.Features.EndToEnd;
using MapleNotes.Server.Infrastructure.Configuration;
using MapleNotes.Server.Tests.TestSupport;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.DependencyInjection;

namespace MapleNotes.Server.Tests.Auth;

/// <summary>Optional two-factor sign-in with an authenticator app (TOTP) and single-use recovery codes.</summary>
public sealed class TwoFactorTests : IAsyncLifetime
{
    private readonly ManualTimeProvider _clock = new(DateTimeOffset.UtcNow);
    private readonly MapleAppFactory _app = new() { Settings = { [MapleOptions.AllowRegistrationKey] = "true" } };
    private readonly ApiClient _client;

    public TwoFactorTests()
    {
        _app.ConfigureTestServices = services => services.AddSingleton<TimeProvider>(_clock);
        _client = new ApiClient(_app);
    }

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    public async ValueTask InitializeAsync() => await _client.SignUpAsync("maple");

    public async ValueTask DisposeAsync()
    {
        _client.Dispose();
        await _app.DisposeAsync();
    }

    [Theory]
    [InlineData(59, "287082")]
    [InlineData(1111111109, "081804")]
    [InlineData(1234567890, "005924")]
    [InlineData(2000000000, "279037")]
    public void Codes_match_the_rfc_6238_test_vectors(long unixSeconds, string expected)
    {
        // RFC 6238 Appendix B (SHA-1), last six of the eight digits.
        var secret = Encoding.ASCII.GetBytes("12345678901234567890");
        Assert.Equal(expected, Totp.Code(secret, Totp.StepAt(DateTimeOffset.FromUnixTimeSeconds(unixSeconds))));
    }

    [Fact]
    public void Base32_round_trips_and_ignores_case_spaces_and_padding()
    {
        var bytes = RandomNumberGenerator.GetBytes(Totp.SecretBytes);
        var text = Totp.ToBase32(bytes);

        Assert.Equal(bytes, Totp.FromBase32(text));
        Assert.Equal(bytes, Totp.FromBase32(string.Join(' ', text.Chunk(4).Select(c => new string(c))).ToLowerInvariant() + "===="));
        Assert.Equal("MZXW6YTBOI", Totp.ToBase32("foobar"u8));
        Assert.Null(Totp.FromBase32("not base32!"));
    }

    [Fact]
    public async Task Setup_saves_nothing_until_a_code_confirms_it()
    {
        var setup = await SetupAsync();

        Assert.StartsWith("otpauth://totp/Maple%20Notes%3Amaple?secret=" + setup.Secret, setup.Uri);
        Assert.Contains("&issuer=Maple%20Notes", setup.Uri);
        Assert.False((await _client.GetJsonAsync<TwoFactorStatusResponse>("/api/v1/account/two-factor"))!.Enabled);

        var wrongCode = await _client.PostJsonAsync("/api/v1/account/two-factor",
            new EnableTwoFactorRequest(await _client.ProofAsync(), setup.Secret, WrongCode(setup.Secret)));
        var wrongPassword = await _client.PostJsonAsync("/api/v1/account/two-factor",
            new EnableTwoFactorRequest(await _client.ProofAsync("wrong password"), setup.Secret, CurrentCode(setup.Secret)));

        Assert.Contains("code", (await ReadProblemAsync(wrongCode)).Errors.Keys);
        Assert.Contains("password", (await ReadProblemAsync(wrongPassword)).Errors.Keys);
        Assert.False((await _client.GetJsonAsync<UserResponse>("/api/v1/auth/me"))!.TwoFactorEnabled);
    }

    [Fact]
    public async Task Turning_it_on_returns_recovery_codes_and_signs_out_other_sessions_only()
    {
        using var otherDevice = new ApiClient(_app);
        await otherDevice.LoginAsync("maple");

        var (_, codes) = await EnableAsync();

        Assert.Equal(TwoFactorService.RecoveryCodeCount, codes.Count);
        Assert.All(codes, code => Assert.Matches("^[a-z2-9]{5}-[a-z2-9]{5}$", code));
        Assert.Equal(codes.Count, codes.Distinct().Count());
        Assert.True((await _client.GetJsonAsync<UserResponse>("/api/v1/auth/me"))!.TwoFactorEnabled);
        Assert.Equal(new TwoFactorStatusResponse(true, 10), await _client.GetJsonAsync<TwoFactorStatusResponse>("/api/v1/account/two-factor"));
        Assert.Equal(HttpStatusCode.Unauthorized, (await otherDevice.GetAsync("/api/v1/auth/me")).StatusCode);
    }

    [Fact]
    public async Task Signing_in_asks_for_a_code_after_the_right_password_and_accepts_each_code_once()
    {
        var (secret, _) = await EnableAsync();
        using var device = new ApiClient(_app);

        var wrongPassword = await device.LoginAsync("maple", "wrong password");
        var noCode = await device.LoginAsync("maple");
        var signedInWithoutCode = (await device.GetAsync("/api/v1/auth/me")).StatusCode;
        _clock.Advance(TimeSpan.FromSeconds(Totp.StepSeconds));
        var code = CurrentCode(secret);
        var withCode = await device.LoginAsync("maple", twoFactorCode: code);
        using var replay = new ApiClient(_app);
        var replayed = await replay.LoginAsync("maple", twoFactorCode: code);

        Assert.Equal(HttpStatusCode.Unauthorized, wrongPassword.StatusCode);
        Assert.False(await AsksForCodeAsync(wrongPassword));
        Assert.Equal(HttpStatusCode.Unauthorized, noCode.StatusCode);
        Assert.True(await AsksForCodeAsync(noCode));
        Assert.Equal(HttpStatusCode.Unauthorized, signedInWithoutCode);
        Assert.Equal(HttpStatusCode.OK, withCode.StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await device.GetAsync("/api/v1/auth/me")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, replayed.StatusCode);
        Assert.True(await AsksForCodeAsync(replayed));
    }

    [Fact]
    public async Task Wrong_codes_lock_the_account_and_the_password_alone_does_not_reset_the_count()
    {
        var (secret, _) = await EnableAsync();
        using var attacker = new ApiClient(_app);

        for (var i = 0; i < AccountService.MaxFailedAttempts - 1; i++)
        {
            Assert.Equal(HttpStatusCode.Unauthorized, (await attacker.LoginAsync("maple", twoFactorCode: WrongCode(secret))).StatusCode);
            await attacker.LoginAsync("maple"); // the right password without a code
        }

        var last = await attacker.LoginAsync("maple", twoFactorCode: WrongCode(secret));
        _clock.Advance(TimeSpan.FromSeconds(Totp.StepSeconds));
        var rightCode = await attacker.LoginAsync("maple", twoFactorCode: CurrentCode(secret));

        Assert.Equal(HttpStatusCode.TooManyRequests, last.StatusCode);
        Assert.Equal(HttpStatusCode.TooManyRequests, rightCode.StatusCode);
    }

    [Fact]
    public async Task A_recovery_code_signs_in_once_in_place_of_a_code()
    {
        var (_, codes) = await EnableAsync();
        using var device = new ApiClient(_app);

        var first = await device.LoginAsync("maple", twoFactorCode: codes[3].ToUpperInvariant().Replace("-", " "));
        using var again = new ApiClient(_app);
        var second = await again.LoginAsync("maple", twoFactorCode: codes[3]);

        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, second.StatusCode);
        Assert.Equal(9, (await device.GetJsonAsync<TwoFactorStatusResponse>("/api/v1/account/two-factor"))!.RecoveryCodesLeft);
    }

    [Fact]
    public async Task Turning_it_off_or_replacing_recovery_codes_needs_the_password_and_a_code()
    {
        var (secret, codes) = await EnableAsync();
        _clock.Advance(TimeSpan.FromSeconds(Totp.StepSeconds));

        var noCode = await _client.PostJsonAsync("/api/v1/account/two-factor/recovery-codes",
            new TwoFactorConfirmation(await _client.ProofAsync(), WrongCode(secret)));
        var replaced = await ReadAsync<RecoveryCodesResponse>(await _client.PostJsonAsync("/api/v1/account/two-factor/recovery-codes",
            new TwoFactorConfirmation(await _client.ProofAsync(), CurrentCode(secret))));
        var oldCode = await _client.DeleteJsonAsync("/api/v1/account/two-factor", new TwoFactorConfirmation(await _client.ProofAsync(), codes[0]));
        var wrongPassword = await _client.DeleteJsonAsync("/api/v1/account/two-factor",
            new TwoFactorConfirmation(await _client.ProofAsync("wrong password"), replaced.Codes[0]));
        var off = await _client.DeleteJsonAsync("/api/v1/account/two-factor", new TwoFactorConfirmation(await _client.ProofAsync(), replaced.Codes[0]));

        Assert.Equal(HttpStatusCode.BadRequest, noCode.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, oldCode.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, wrongPassword.StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, off.StatusCode);
        using var device = new ApiClient(_app);
        Assert.Equal(HttpStatusCode.OK, (await device.LoginAsync("maple")).StatusCode);
    }

    [Fact]
    public async Task An_administrator_can_turn_it_off_for_an_account_that_lost_its_codes()
    {
        using var member = new ApiClient(_app);
        var memberUser = await member.SignUpAsync("member");
        var (_, codes) = await EnableAsync(member);
        using var device = new ApiClient(_app);
        Assert.Equal(HttpStatusCode.Unauthorized, (await device.LoginAsync("member")).StatusCode);

        var listed = await _client.GetJsonAsync<List<AdminUserResponse>>("/api/v1/admin/users");
        var response = await _client.PatchJsonAsync($"/api/v1/admin/users/{memberUser.Id}", new UpdateUserRequest(TurnOffTwoFactor: true));

        Assert.True(listed!.Single(u => u.Id == memberUser.Id).TwoFactorEnabled);
        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await device.LoginAsync("member")).StatusCode);
        Assert.NotEmpty(codes);
    }

    [Fact]
    public async Task A_reset_with_the_recovery_key_needs_the_second_factor_too()
    {
        var account = await EndToEndAccount.EnableAsync(_client);
        var (secret, _) = await EnableAsync();
        using var visitor = new ApiClient(_app);
        await visitor.RefreshAntiforgeryTokenAsync();
        var (recoveryWrap, recoveryAuth) = E2eeCrypto.RecoveryKeys(account.RecoveryKey);
        var recovered = await ReadAsync<RecoveryKeyResponse>(
            await visitor.PostJsonAsync("/api/v1/auth/recovery/key", new RecoveryKeyRequest("maple", recoveryAuth)));
        var dataKey = E2eeCrypto.Open(recoveryWrap, recovered.RecoveryWrappedKey, E2eeCrypto.RecoveryContext(account.UserId));
        var newKdf = ApiClient.TestKdf("a brand new passphrase");
        var (newAuth, newWrap) = ApiClient.DeriveKeys("a brand new passphrase", newKdf);
        var (newRecoveryWrap, newRecoveryAuth) = E2eeCrypto.RecoveryKeys(RandomNumberGenerator.GetBytes(32));
        ResetWithRecoveryKeyRequest Reset(string? code) => new(
            "maple", recoveryAuth, newKdf, newAuth,
            E2eeCrypto.Seal(newWrap, dataKey, E2eeCrypto.DataKeyContext(account.UserId)),
            E2eeCrypto.Seal(newRecoveryWrap, dataKey, E2eeCrypto.RecoveryContext(account.UserId)),
            newRecoveryAuth, code);

        var noCode = await visitor.PostJsonAsync("/api/v1/auth/recovery/reset", Reset(null));
        var wrongCode = await visitor.PostJsonAsync("/api/v1/auth/recovery/reset", Reset(WrongCode(secret)));
        _clock.Advance(TimeSpan.FromSeconds(Totp.StepSeconds));
        var withCode = await visitor.PostJsonAsync("/api/v1/auth/recovery/reset", Reset(CurrentCode(secret)));

        Assert.True(await AsksForCodeAsync(noCode));
        Assert.True(await AsksForCodeAsync(wrongCode));
        Assert.Equal(HttpStatusCode.OK, withCode.StatusCode);
        Assert.True((await ReadAsync<UserResponse>(withCode)).TwoFactorEnabled); // a reset keeps two-factor sign-in on
    }

    [Fact]
    public async Task The_secret_and_recovery_codes_are_not_stored_in_plain_form()
    {
        var (secret, codes) = await EnableAsync();

        var leaks = await DatabaseScanner.ScanAsync(_app, [secret, .. codes, .. codes.Select(c => c.Replace("-", ""))]);

        Assert.Empty(leaks);
    }

    private async Task<TwoFactorSetupResponse> SetupAsync(ApiClient? client = null) =>
        await ReadAsync<TwoFactorSetupResponse>(await (client ?? _client).PostAsync("/api/v1/account/two-factor/setup"));

    private async Task<(string Secret, IReadOnlyList<string> Codes)> EnableAsync(ApiClient? client = null)
    {
        client ??= _client;
        var setup = await SetupAsync(client);
        var response = await client.PostJsonAsync("/api/v1/account/two-factor",
            new EnableTwoFactorRequest(await client.ProofAsync(), setup.Secret, CurrentCode(setup.Secret)));
        var codes = await ReadAsync<RecoveryCodesResponse>(response);
        await client.RefreshAntiforgeryTokenAsync();
        return (setup.Secret, codes.Codes);
    }

    private string CurrentCode(string secret) => Totp.Code(Totp.FromBase32(secret)!, Totp.StepAt(_clock.GetUtcNow()));

    // A code that is wrong for every step the server accepts.
    private string WrongCode(string secret)
    {
        var bytes = Totp.FromBase32(secret)!;
        var step = Totp.StepAt(_clock.GetUtcNow());
        var taken = new[] { step - 1, step, step + 1 }.Select(s => Totp.Code(bytes, s)).ToHashSet();
        return Enumerable.Range(0, 1000).Select(i => i.ToString("D6")).First(c => !taken.Contains(c));
    }

    private static async Task<bool> AsksForCodeAsync(HttpResponseMessage response)
    {
        if (response.StatusCode != HttpStatusCode.Unauthorized)
        {
            return false;
        }

        var problem = await response.Content.ReadFromJsonAsync<ProblemDetails>(ApiClient.Json, Ct);
        return problem!.Extensions.TryGetValue("twoFactorRequired", out var value) && value is JsonElement { ValueKind: JsonValueKind.True };
    }

    private static async Task<ValidationProblemDetails> ReadProblemAsync(HttpResponseMessage response)
    {
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<ValidationProblemDetails>(ApiClient.Json, Ct))!;
    }

    private static async Task<T> ReadAsync<T>(HttpResponseMessage response)
    {
        Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync(Ct));
        return (await response.Content.ReadFromJsonAsync<T>(ApiClient.Json, Ct))!;
    }
}
