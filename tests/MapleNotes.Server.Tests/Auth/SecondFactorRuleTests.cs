using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MapleNotes.Server.Domain;
using MapleNotes.Server.Features.Admin;
using MapleNotes.Server.Features.Audit;
using MapleNotes.Server.Features.Auth;
using MapleNotes.Server.Features.Passkeys;
using MapleNotes.Server.Infrastructure.Configuration;
using MapleNotes.Server.Tests.TestSupport;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.DependencyInjection;

namespace MapleNotes.Server.Tests.Auth;

/// <summary>
/// The instance setting "Require two-factor sign-in or a passkey" (Off / Administrators / Everyone): sessions of
/// accounts it covers that have neither reach only the enrolment endpoints, and an administrator cannot take away
/// the last factor of an account it covers.
/// </summary>
public sealed class SecondFactorRuleTests : IAsyncLifetime
{
    private readonly ManualTimeProvider _clock = new(DateTimeOffset.UtcNow);
    private readonly MapleAppFactory _app = new() { Settings = { [MapleOptions.AllowRegistrationKey] = "true" } };
    private readonly ApiClient _admin;
    private readonly ApiClient _member;
    private UserResponse _memberUser = null!;

    public SecondFactorRuleTests()
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
    public async Task Off_is_the_default_and_restricts_nobody()
    {
        var settings = await _admin.GetJsonAsync<InstanceSettingsResponse>("/api/v1/admin/settings");

        Assert.Equal(SecondFactorRule.Off, settings!.RequireSecondFactor);
        Assert.Equal(HttpStatusCode.OK, (await _member.GetAsync("/api/v1/notes")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await _admin.GetAsync("/api/v1/notes")).StatusCode);
        Assert.False((await _member.GetJsonAsync<UserResponse>("/api/v1/auth/me"))!.SecondFactorEnrolmentRequired);
    }

    [Fact]
    public async Task Administrators_restricts_only_administrators_without_a_second_factor()
    {
        await EnableTotpAsync(_admin);
        await SetRuleAsync(SecondFactorRule.Administrators);
        using var other = new ApiClient(_app);
        var otherUser = await other.SignUpAsync("other");
        (await _admin.PatchJsonAsync($"/api/v1/admin/users/{otherUser.Id}", new UpdateUserRequest(Role: UserRole.Admin))).EnsureSuccessStatusCode();

        Assert.Equal(HttpStatusCode.OK, (await _admin.GetAsync("/api/v1/admin/users")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await _member.GetAsync("/api/v1/notes")).StatusCode);
        await AssertRestrictedAsync(other);
        Assert.True((await other.GetJsonAsync<UserResponse>("/api/v1/auth/me"))!.SecondFactorEnrolmentRequired);
        Assert.Equal(HttpStatusCode.Forbidden, (await other.GetAsync("/api/v1/admin/users")).StatusCode);
    }

    [Fact]
    public async Task Everyone_restricts_existing_sessions_at_once_until_they_enrol()
    {
        await EnableTotpAsync(_admin);
        await SetRuleAsync(SecondFactorRule.Everyone);

        // The member signed in before the rule: its session is restricted on its next request.
        await AssertRestrictedAsync(_member);
        Assert.Equal(HttpStatusCode.Forbidden, (await _member.PutJsonAsync("/api/v1/account/preferences", new UserPreferences())).StatusCode);
        Assert.True((await _member.GetJsonAsync<UserResponse>("/api/v1/auth/me"))!.SecondFactorEnrolmentRequired);

        // The enrolment endpoints still answer: here a passkey is registered, which lifts the restriction.
        Assert.Equal(HttpStatusCode.OK, (await _member.GetAsync("/api/v1/account/two-factor")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await _member.GetAsync("/api/v1/auth/session-key")).StatusCode);
        await AddPasskeyAsync(_member);

        Assert.Equal(HttpStatusCode.OK, (await _member.GetAsync("/api/v1/notes")).StatusCode);
        Assert.False((await _member.GetJsonAsync<UserResponse>("/api/v1/auth/me"))!.SecondFactorEnrolmentRequired);
    }

    [Fact]
    public async Task A_covered_account_can_still_sign_in_set_up_two_factor_sign_in_and_sign_out()
    {
        await EnableTotpAsync(_admin);
        await SetRuleAsync(SecondFactorRule.Everyone);
        using var device = new ApiClient(_app);

        var login = await device.LoginAsync("member");
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        Assert.True((await login.Content.ReadFromJsonAsync<UserResponse>(ApiClient.Json, Ct))!.SecondFactorEnrolmentRequired);
        await device.RefreshAntiforgeryTokenAsync();
        await AssertRestrictedAsync(device);

        await EnableTotpAsync(device);
        Assert.Equal(HttpStatusCode.OK, (await device.GetAsync("/api/v1/notes")).StatusCode);

        Assert.Equal(HttpStatusCode.NoContent, (await device.PostAsync("/api/v1/auth/logout")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await device.GetAsync("/api/v1/auth/me")).StatusCode);
    }

    [Fact]
    public async Task A_restricted_session_can_sign_out()
    {
        await EnableTotpAsync(_admin);
        await SetRuleAsync(SecondFactorRule.Everyone);

        Assert.Equal(HttpStatusCode.NoContent, (await _member.PostAsync("/api/v1/auth/logout")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await _member.GetAsync("/api/v1/notes")).StatusCode);
    }

    [Fact]
    public async Task An_administrator_without_a_second_factor_cannot_turn_the_rule_on()
    {
        var refused = await _admin.PutJsonAsync("/api/v1/admin/settings",
            new UpdateInstanceSettingsRequest(true, RequireSecondFactor: SecondFactorRule.Administrators));
        var unknown = await _admin.PutJsonAsync("/api/v1/admin/settings",
            new UpdateInstanceSettingsRequest(true, RequireSecondFactor: (SecondFactorRule)7));

        Assert.Equal(HttpStatusCode.Conflict, refused.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, unknown.StatusCode);
        Assert.Equal(SecondFactorRule.Off, (await _admin.GetJsonAsync<InstanceSettingsResponse>("/api/v1/admin/settings"))!.RequireSecondFactor);
        Assert.Equal(HttpStatusCode.OK, (await _admin.GetAsync("/api/v1/admin/users")).StatusCode);
    }

    [Fact]
    public async Task Leaving_the_rule_out_keeps_it_and_changes_are_audited()
    {
        await EnableTotpAsync(_admin);
        await SetRuleAsync(SecondFactorRule.Administrators);
        (await _admin.PutJsonAsync("/api/v1/admin/settings", new UpdateInstanceSettingsRequest(true, SessionDays: 14))).EnsureSuccessStatusCode();
        await SetRuleAsync(SecondFactorRule.Off);

        var entries = (await _admin.GetJsonAsync<AuditPageResponse>("/api/v1/admin/audit?filter=Admin"))!.Items;
        Assert.Equal(
            [
                "Sessions last: 14 → 30 days. Second factor required for: administrators → nobody.",
                "Sessions last: 30 → 14 days.",
                "Second factor required for: nobody → administrators.",
            ],
            entries.Where(e => e.Event == AuditEvent.SettingsChanged).Select(e => e.Detail));
    }

    [Fact]
    public async Task An_administrator_cannot_turn_off_the_last_factor_of_a_covered_account()
    {
        await EnableTotpAsync(_admin);
        await EnableTotpAsync(_member);
        await SetRuleAsync(SecondFactorRule.Everyone);
        var url = $"/api/v1/admin/users/{_memberUser.Id}";

        var refused = await _admin.PatchJsonAsync(url, new UpdateUserRequest(TurnOffTwoFactor: true));
        Assert.Equal(HttpStatusCode.Conflict, refused.StatusCode);
        Assert.Contains("only one", (await refused.Content.ReadFromJsonAsync<ProblemDetails>(ApiClient.Json, Ct))!.Title);
        Assert.True((await _member.GetJsonAsync<UserResponse>("/api/v1/auth/me"))!.TwoFactorEnabled);

        // With a passkey as well, two-factor sign-in is not the last factor.
        await AddPasskeyAsync(_member);
        var listed = await _admin.GetJsonAsync<List<AdminUserResponse>>("/api/v1/admin/users");
        Assert.True(listed!.Single(u => u.Id == _memberUser.Id).HasPasskey);
        Assert.Equal(HttpStatusCode.NoContent, (await _admin.PatchJsonAsync(url, new UpdateUserRequest(TurnOffTwoFactor: true))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await _member.GetAsync("/api/v1/notes")).StatusCode);
    }

    [Fact]
    public async Task The_last_factor_check_follows_who_the_rule_covers()
    {
        await EnableTotpAsync(_admin);
        await EnableTotpAsync(_member);
        await SetRuleAsync(SecondFactorRule.Administrators);
        var url = $"/api/v1/admin/users/{_memberUser.Id}";

        // Promoting the member and turning its only factor off in one change is judged with the new role.
        Assert.Equal(HttpStatusCode.Conflict,
            (await _admin.PatchJsonAsync(url, new UpdateUserRequest(Role: UserRole.Admin, TurnOffTwoFactor: true))).StatusCode);
        var listed = await _admin.GetJsonAsync<List<AdminUserResponse>>("/api/v1/admin/users");
        Assert.Equal(UserRole.User, listed!.Single(u => u.Id == _memberUser.Id).Role); // nothing was saved

        // A regular account is not covered by "Administrators".
        Assert.Equal(HttpStatusCode.NoContent, (await _admin.PatchJsonAsync(url, new UpdateUserRequest(TurnOffTwoFactor: true))).StatusCode);
        Assert.False((await _member.GetJsonAsync<UserResponse>("/api/v1/auth/me"))!.TwoFactorEnabled);
    }

    private async Task SetRuleAsync(SecondFactorRule rule)
    {
        var response = await _admin.PutJsonAsync("/api/v1/admin/settings", new UpdateInstanceSettingsRequest(true, RequireSecondFactor: rule));
        Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync(Ct));
        Assert.Equal(rule, (await response.Content.ReadFromJsonAsync<InstanceSettingsResponse>(ApiClient.Json, Ct))!.RequireSecondFactor);
    }

    private static async Task AssertRestrictedAsync(ApiClient client)
    {
        var response = await client.GetAsync("/api/v1/notes");
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        using var problem = JsonDocument.Parse(await response.Content.ReadAsStringAsync(Ct));
        Assert.Equal(SecondFactorPolicy.EnrolmentRequiredCode, problem.RootElement.GetProperty("code").GetString());
    }

    private async Task EnableTotpAsync(ApiClient client)
    {
        var setupResponse = await client.PostAsync("/api/v1/account/two-factor/setup");
        Assert.True(setupResponse.IsSuccessStatusCode, await setupResponse.Content.ReadAsStringAsync(Ct));
        var setup = (await setupResponse.Content.ReadFromJsonAsync<TwoFactorSetupResponse>(ApiClient.Json, Ct))!;
        var code = Totp.Code(Totp.FromBase32(setup.Secret)!, Totp.StepAt(_clock.GetUtcNow()));
        var response = await client.PostJsonAsync("/api/v1/account/two-factor", new EnableTwoFactorRequest(await client.ProofAsync(), setup.Secret, code));
        Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync(Ct));
        await client.RefreshAntiforgeryTokenAsync();
        _clock.Advance(TimeSpan.FromSeconds(30)); // the next account's code must be for a later step
    }

    private static async Task AddPasskeyAsync(ApiClient client)
    {
        var optionsResponse = await client.PostAsync("/api/v1/account/passkeys/options");
        Assert.True(optionsResponse.IsSuccessStatusCode, await optionsResponse.Content.ReadAsStringAsync(Ct));
        var options = (await optionsResponse.Content.ReadFromJsonAsync<PasskeyCreationOptions>(ApiClient.Json, Ct))!;
        var response = await client.PostJsonAsync("/api/v1/account/passkeys",
            new AddPasskeyRequest(await client.ProofAsync(), options.ChallengeId, null, new FakeAuthenticator().Create(options)));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    }
}
