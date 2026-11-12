using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MapleNotes.Server.Domain;
using MapleNotes.Server.Features.Admin;
using MapleNotes.Server.Features.Auth;
using MapleNotes.Server.Features.Passkeys;
using MapleNotes.Server.Infrastructure.Configuration;
using MapleNotes.Server.Tests.TestSupport;
using Microsoft.Extensions.DependencyInjection;

namespace MapleNotes.Server.Tests.Auth;

/// <summary>
/// Step-up confirmation: exports, administration and second-factor changes need a confirmation (password, passkey or
/// authenticator code) from the last ten minutes of the same session. Signing in counts as one.
/// </summary>
public sealed class StepUpConfirmationTests : IAsyncLifetime
{
    private static readonly TimeSpan PastWindow = RecentConfirmation.Window + TimeSpan.FromMinutes(1);

    private readonly ManualTimeProvider _clock = new(DateTimeOffset.UtcNow);
    private readonly MapleAppFactory _app = new() { Settings = { [MapleOptions.AllowRegistrationKey] = "true" } };
    private readonly ApiClient _admin;
    private readonly ApiClient _member;
    private UserResponse _memberUser = null!;

    public StepUpConfirmationTests()
    {
        _app.ConfigureTestServices = services => services.AddSingleton<TimeProvider>(_clock);
        _admin = new ApiClient(_app);
        _member = new ApiClient(_app);
    }

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    public async ValueTask InitializeAsync()
    {
        await _admin.SignUpAsync("admin");
        _memberUser = await _member.SignUpAsync("member");
    }

    public async ValueTask DisposeAsync()
    {
        _admin.Dispose();
        _member.Dispose();
        await _app.DisposeAsync();
    }

    [Fact]
    public async Task Signing_in_counts_as_a_confirmation_for_ten_minutes()
    {
        var status = await _member.GetJsonAsync<ConfirmationResponse>("/api/v1/auth/confirm");
        Assert.NotNull(status!.ConfirmedUntilUtc);
        Assert.Equal(HttpStatusCode.OK, (await ExportAsync(_member)).StatusCode);

        _clock.Advance(PastWindow);

        Assert.Null((await _member.GetJsonAsync<ConfirmationResponse>("/api/v1/auth/confirm"))!.ConfirmedUntilUtc);
        await AssertConfirmationRequiredAsync(await ExportAsync(_member));
        Assert.Equal(HttpStatusCode.OK, (await _member.GetAsync("/api/v1/notes")).StatusCode); // everyday use is not affected
    }

    [Fact]
    public async Task Export_needs_a_fresh_confirmation()
    {
        _clock.Advance(PastWindow);
        await AssertConfirmationRequiredAsync(await ExportAsync(_member));

        await ConfirmWithPasswordAsync(_member);

        Assert.Equal(HttpStatusCode.OK, (await ExportAsync(_member)).StatusCode);
    }

    [Fact]
    public async Task Instance_settings_need_a_fresh_confirmation()
    {
        _clock.Advance(PastWindow);
        await AssertConfirmationRequiredAsync(await SaveSettingsAsync());
        Assert.Equal(HttpStatusCode.OK, (await _admin.GetAsync("/api/v1/admin/settings")).StatusCode); // reading is fine

        await ConfirmWithPasswordAsync(_admin);

        Assert.Equal(HttpStatusCode.OK, (await SaveSettingsAsync()).StatusCode);
    }

    [Fact]
    public async Task Role_changes_and_disabling_need_a_fresh_confirmation()
    {
        _clock.Advance(PastWindow);
        await AssertConfirmationRequiredAsync(await _admin.PatchJsonAsync($"/api/v1/admin/users/{_memberUser.Id}", new UpdateUserRequest(Role: UserRole.Admin)));
        await AssertConfirmationRequiredAsync(await _admin.PatchJsonAsync($"/api/v1/admin/users/{_memberUser.Id}", new UpdateUserRequest(IsDisabled: true)));
        Assert.Equal(UserRole.User, (await _admin.GetJsonAsync<List<AdminUserResponse>>("/api/v1/admin/users"))!.Single(u => u.Id == _memberUser.Id).Role);

        await ConfirmWithPasswordAsync(_admin);

        Assert.Equal(HttpStatusCode.NoContent, (await _admin.PatchJsonAsync($"/api/v1/admin/users/{_memberUser.Id}", new UpdateUserRequest(Role: UserRole.Admin))).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await _admin.PatchJsonAsync($"/api/v1/admin/users/{_memberUser.Id}", new UpdateUserRequest(IsDisabled: true))).StatusCode);
    }

    [Fact]
    public async Task Turning_off_another_accounts_two_factor_needs_a_fresh_confirmation()
    {
        await EnableTotpAsync(_member);
        _clock.Advance(PastWindow);
        await AssertConfirmationRequiredAsync(await _admin.PatchJsonAsync($"/api/v1/admin/users/{_memberUser.Id}", new UpdateUserRequest(TurnOffTwoFactor: true)));
        Assert.True((await _member.GetJsonAsync<TwoFactorStatusResponse>("/api/v1/account/two-factor"))!.Enabled);

        await ConfirmWithPasswordAsync(_admin);

        Assert.Equal(HttpStatusCode.NoContent, (await _admin.PatchJsonAsync($"/api/v1/admin/users/{_memberUser.Id}", new UpdateUserRequest(TurnOffTwoFactor: true))).StatusCode);
    }

    [Fact]
    public async Task Deleting_an_account_needs_a_fresh_confirmation()
    {
        _clock.Advance(PastWindow);
        await AssertConfirmationRequiredAsync(await _admin.DeleteAsync($"/api/v1/admin/users/{_memberUser.Id}"));
        Assert.Contains((await _admin.GetJsonAsync<List<AdminUserResponse>>("/api/v1/admin/users"))!, u => u.Id == _memberUser.Id);

        await ConfirmWithPasswordAsync(_admin);

        Assert.Equal(HttpStatusCode.NoContent, (await _admin.DeleteAsync($"/api/v1/admin/users/{_memberUser.Id}")).StatusCode);
    }

    [Fact]
    public async Task Adding_and_removing_a_passkey_need_a_fresh_confirmation()
    {
        using var device = new FakeAuthenticator();
        _clock.Advance(PastWindow);
        await AssertConfirmationRequiredAsync(await AddPasskeyAsync(_member, device));

        await ConfirmWithPasswordAsync(_member);
        var added = await AddPasskeyAsync(_member, device);
        Assert.Equal(HttpStatusCode.Created, added.StatusCode);
        var passkey = (await added.Content.ReadFromJsonAsync<PasskeyResponse>(ApiClient.Json, Ct))!;

        _clock.Advance(PastWindow);
        await AssertConfirmationRequiredAsync(await _member.DeleteJsonAsync($"/api/v1/account/passkeys/{passkey.Id}", new RemovePasskeyRequest(await _member.ProofAsync())));

        await ConfirmWithPasswordAsync(_member);
        Assert.Equal(HttpStatusCode.NoContent, (await _member.DeleteJsonAsync($"/api/v1/account/passkeys/{passkey.Id}", new RemovePasskeyRequest(await _member.ProofAsync()))).StatusCode);
    }

    [Fact]
    public async Task Turning_off_two_factor_needs_a_fresh_confirmation()
    {
        var secret = await EnableTotpAsync(_member);
        _clock.Advance(PastWindow);
        await AssertConfirmationRequiredAsync(await _member.DeleteJsonAsync(
            "/api/v1/account/two-factor", new TwoFactorConfirmation(await _member.ProofAsync(), CodeNow(secret))));

        await ConfirmWithPasswordAsync(_member);
        _clock.Advance(TimeSpan.FromSeconds(30)); // a code is accepted once per step

        Assert.Equal(HttpStatusCode.NoContent, (await _member.DeleteJsonAsync(
            "/api/v1/account/two-factor", new TwoFactorConfirmation(await _member.ProofAsync(), CodeNow(secret)))).StatusCode);
    }

    [Fact]
    public async Task Replacing_recovery_codes_needs_a_fresh_confirmation()
    {
        var secret = await EnableTotpAsync(_member);
        _clock.Advance(PastWindow);
        await AssertConfirmationRequiredAsync(await _member.PostJsonAsync(
            "/api/v1/account/two-factor/recovery-codes", new TwoFactorConfirmation(await _member.ProofAsync(), CodeNow(secret))));

        await ConfirmWithPasswordAsync(_member);
        _clock.Advance(TimeSpan.FromSeconds(30));

        Assert.Equal(HttpStatusCode.OK, (await _member.PostJsonAsync(
            "/api/v1/account/two-factor/recovery-codes", new TwoFactorConfirmation(await _member.ProofAsync(), CodeNow(secret)))).StatusCode);
    }

    [Fact]
    public async Task A_confirmation_covers_only_its_own_session()
    {
        using var other = new ApiClient(_app);
        (await other.LoginAsync("member")).EnsureSuccessStatusCode();
        _clock.Advance(PastWindow);

        await ConfirmWithPasswordAsync(_member);

        Assert.Equal(HttpStatusCode.OK, (await ExportAsync(_member)).StatusCode);
        await AssertConfirmationRequiredAsync(await ExportAsync(other));
    }

    [Fact]
    public async Task A_wrong_password_is_refused_and_counts_toward_the_lockout()
    {
        _clock.Advance(PastWindow);

        var wrong = await _member.PostJsonAsync("/api/v1/auth/confirm", new ConfirmRequest(Proof: await _member.ProofAsync("wrong password")));
        Assert.Equal(HttpStatusCode.BadRequest, wrong.StatusCode);
        await AssertConfirmationRequiredAsync(await ExportAsync(_member));

        for (var i = 1; i < AccountService.MaxFailedAttempts; i++)
        {
            await _member.PostJsonAsync("/api/v1/auth/confirm", new ConfirmRequest(Proof: await _member.ProofAsync("wrong password")));
        }

        // Locked now: even the right password is refused, here and at sign-in.
        var locked = await _member.PostJsonAsync("/api/v1/auth/confirm", new ConfirmRequest(Proof: await _member.ProofAsync()));
        Assert.Equal(HttpStatusCode.TooManyRequests, locked.StatusCode);
        using var other = new ApiClient(_app);
        Assert.Equal(HttpStatusCode.TooManyRequests, (await other.LoginAsync("member")).StatusCode);
    }

    [Fact]
    public async Task Exactly_one_method_must_be_sent()
    {
        var none = await _member.PostJsonAsync("/api/v1/auth/confirm", new ConfirmRequest());
        Assert.Equal(HttpStatusCode.BadRequest, none.StatusCode);

        var two = await _member.PostJsonAsync("/api/v1/auth/confirm", new ConfirmRequest(Proof: await _member.ProofAsync(), Code: "123456"));
        Assert.Equal(HttpStatusCode.BadRequest, two.StatusCode);
    }

    [Fact]
    public async Task An_authenticator_code_confirms_when_two_factor_is_on()
    {
        var refused = await _member.PostJsonAsync("/api/v1/auth/confirm", new ConfirmRequest(Code: "123456"));
        Assert.Equal(HttpStatusCode.BadRequest, refused.StatusCode); // two-factor sign-in is off

        var secret = await EnableTotpAsync(_member);
        _clock.Advance(PastWindow);
        Assert.Equal(HttpStatusCode.BadRequest, (await _member.PostJsonAsync("/api/v1/auth/confirm", new ConfirmRequest(Code: "000000"))).StatusCode);
        await AssertConfirmationRequiredAsync(await ExportAsync(_member));

        var response = await _member.PostJsonAsync("/api/v1/auth/confirm", new ConfirmRequest(Code: CodeNow(secret)));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await ExportAsync(_member)).StatusCode);
    }

    [Fact]
    public async Task Wrong_authenticator_codes_count_toward_the_lockout()
    {
        await EnableTotpAsync(_member);
        for (var i = 0; i < AccountService.MaxFailedAttempts; i++)
        {
            await _member.PostJsonAsync("/api/v1/auth/confirm", new ConfirmRequest(Code: "000000"));
        }

        Assert.Equal(HttpStatusCode.TooManyRequests, (await _member.PostJsonAsync("/api/v1/auth/confirm", new ConfirmRequest(Proof: await _member.ProofAsync()))).StatusCode);
    }

    [Fact]
    public async Task A_passkey_of_the_account_confirms()
    {
        using var device = new FakeAuthenticator();
        Assert.Equal(HttpStatusCode.Created, (await AddPasskeyAsync(_member, device)).StatusCode);
        _clock.Advance(PastWindow);

        var options = await PasskeyOptionsAsync(_member);
        var response = await _member.PostJsonAsync("/api/v1/auth/confirm", new ConfirmRequest(ChallengeId: options.ChallengeId, Passkey: device.Sign(options)));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.NotNull((await response.Content.ReadFromJsonAsync<ConfirmationResponse>(ApiClient.Json, Ct))!.ConfirmedUntilUtc);
        Assert.Equal(HttpStatusCode.OK, (await ExportAsync(_member)).StatusCode);
    }

    [Fact]
    public async Task Another_accounts_passkey_or_a_sign_in_challenge_does_not_confirm()
    {
        using var adminDevice = new FakeAuthenticator();
        Assert.Equal(HttpStatusCode.Created, (await AddPasskeyAsync(_admin, adminDevice)).StatusCode);
        using var memberDevice = new FakeAuthenticator();
        Assert.Equal(HttpStatusCode.Created, (await AddPasskeyAsync(_member, memberDevice)).StatusCode);
        _clock.Advance(PastWindow);

        var options = await PasskeyOptionsAsync(_member);
        var foreign = await _member.PostJsonAsync("/api/v1/auth/confirm", new ConfirmRequest(ChallengeId: options.ChallengeId, Passkey: adminDevice.Sign(options)));
        Assert.Equal(HttpStatusCode.BadRequest, foreign.StatusCode);

        // A challenge issued for signing in cannot be used to confirm.
        var signInOptionsResponse = await _member.PostAsync("/api/v1/auth/passkey/options");
        var signInOptions = (await signInOptionsResponse.Content.ReadFromJsonAsync<PasskeyRequestOptions>(ApiClient.Json, Ct))!;
        var replayed = await _member.PostJsonAsync("/api/v1/auth/confirm", new ConfirmRequest(ChallengeId: signInOptions.ChallengeId, Passkey: memberDevice.Sign(signInOptions)));
        Assert.Equal(HttpStatusCode.BadRequest, replayed.StatusCode);

        await AssertConfirmationRequiredAsync(await ExportAsync(_member));
    }

    [Fact]
    public async Task A_session_restricted_by_the_second_factor_rule_can_still_confirm_to_add_a_passkey()
    {
        await EnableTotpAsync(_admin);
        await _admin.PutJsonAsync("/api/v1/admin/settings", new UpdateInstanceSettingsRequest(true, RequireSecondFactor: SecondFactorRule.Everyone));
        _clock.Advance(PastWindow);

        using var device = new FakeAuthenticator();
        await AssertConfirmationRequiredAsync(await AddPasskeyAsync(_member, device));
        await ConfirmWithPasswordAsync(_member);

        Assert.Equal(HttpStatusCode.Created, (await AddPasskeyAsync(_member, device)).StatusCode);
    }

    private Task<HttpResponseMessage> ExportAsync(ApiClient client) => client.GetAsync("/api/v1/export?format=md");

    private Task<HttpResponseMessage> SaveSettingsAsync() =>
        _admin.PutJsonAsync("/api/v1/admin/settings", new UpdateInstanceSettingsRequest(true, SessionDays: 14));

    private static async Task ConfirmWithPasswordAsync(ApiClient client)
    {
        var response = await client.PostJsonAsync("/api/v1/auth/confirm", new ConfirmRequest(Proof: await client.ProofAsync()));
        Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync(Ct));
        var body = (await response.Content.ReadFromJsonAsync<ConfirmationResponse>(ApiClient.Json, Ct))!;
        Assert.NotNull(body.ConfirmedUntilUtc);
    }

    private static async Task AssertConfirmationRequiredAsync(HttpResponseMessage response)
    {
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        using var problem = JsonDocument.Parse(await response.Content.ReadAsStringAsync(Ct));
        Assert.Equal(RecentConfirmation.RequiredCode, problem.RootElement.GetProperty("code").GetString());
    }

    private static async Task<PasskeyRequestOptions> PasskeyOptionsAsync(ApiClient client)
    {
        var response = await client.PostAsync("/api/v1/auth/confirm/passkey-options");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<PasskeyRequestOptions>(ApiClient.Json, Ct))!;
    }

    private static async Task<HttpResponseMessage> AddPasskeyAsync(ApiClient client, FakeAuthenticator device)
    {
        var optionsResponse = await client.PostAsync("/api/v1/account/passkeys/options");
        Assert.True(optionsResponse.IsSuccessStatusCode, await optionsResponse.Content.ReadAsStringAsync(Ct));
        var options = (await optionsResponse.Content.ReadFromJsonAsync<PasskeyCreationOptions>(ApiClient.Json, Ct))!;
        return await client.PostJsonAsync("/api/v1/account/passkeys",
            new AddPasskeyRequest(await client.ProofAsync(), options.ChallengeId, null, device.Create(options)));
    }

    private string CodeNow(string secret) => Totp.Code(Totp.FromBase32(secret)!, Totp.StepAt(_clock.GetUtcNow()));

    private async Task<string> EnableTotpAsync(ApiClient client)
    {
        var setupResponse = await client.PostAsync("/api/v1/account/two-factor/setup");
        Assert.True(setupResponse.IsSuccessStatusCode, await setupResponse.Content.ReadAsStringAsync(Ct));
        var setup = (await setupResponse.Content.ReadFromJsonAsync<TwoFactorSetupResponse>(ApiClient.Json, Ct))!;
        var response = await client.PostJsonAsync("/api/v1/account/two-factor", new EnableTwoFactorRequest(await client.ProofAsync(), setup.Secret, CodeNow(setup.Secret)));
        Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync(Ct));
        await client.RefreshAntiforgeryTokenAsync();
        _clock.Advance(TimeSpan.FromSeconds(30)); // the next code must be for a later step
        return setup.Secret;
    }
}
