using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using MapleNotes.Server.Features.Admin;
using MapleNotes.Server.Features.Auth;
using MapleNotes.Server.Features.Encryption;
using MapleNotes.Server.Features.Passkeys;
using MapleNotes.Server.Infrastructure.Configuration;
using MapleNotes.Server.Infrastructure.Persistence;
using MapleNotes.Server.Tests.TestSupport;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace MapleNotes.Server.Tests.Passkeys;

/// <summary>Adding passkeys and signing in with them (WebAuthn without attestation).</summary>
public sealed class PasskeyTests : IAsyncLifetime
{
    private readonly ManualTimeProvider _clock = new(DateTimeOffset.UtcNow);
    private readonly MapleAppFactory _app = new() { Settings = { [MapleOptions.AllowRegistrationKey] = "true" } };
    private readonly ApiClient _client;
    private UserResponse _user = null!;

    public PasskeyTests()
    {
        _app.ConfigureTestServices = services => services.AddSingleton<TimeProvider>(_clock);
        _client = new ApiClient(_app);
    }

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    public async ValueTask InitializeAsync() => _user = await _client.SignUpAsync("maple");

    public async ValueTask DisposeAsync()
    {
        _client.Dispose();
        await _app.DisposeAsync();
    }

    [Fact]
    public async Task A_passkey_signs_in_without_the_password()
    {
        using var device = new FakeAuthenticator();
        var added = await AddAsync(device, "My phone");

        Assert.Equal("My phone", added.Name);
        Assert.True(added.BackedUp);
        Assert.Null(added.LastUsedAtUtc);

        using var other = new ApiClient(_app);
        var signedIn = await SignInAsync(other, device);

        Assert.Equal(HttpStatusCode.OK, signedIn.StatusCode);
        Assert.Equal("maple", (await signedIn.Content.ReadFromJsonAsync<UserResponse>(ApiClient.Json, Ct))!.Username);
        Assert.Equal("maple", (await other.GetJsonAsync<UserResponse>("/api/v1/auth/me"))!.Username);
        var listed = Assert.Single((await _client.GetJsonAsync<List<PasskeyResponse>>("/api/v1/account/passkeys"))!);
        Assert.Equal(_clock.GetUtcNow().UtcDateTime, listed.LastUsedAtUtc);
    }

    [Fact]
    public async Task Creation_options_describe_the_site_and_account_and_exclude_existing_passkeys()
    {
        using var device = new FakeAuthenticator();
        var first = await CreationOptionsAsync();

        Assert.Equal(new RelyingParty("localhost", "Maple Notes"), first.Rp);
        Assert.Equal("maple", first.User.Name);
        Assert.Equal(_user.Id.ToByteArray(bigEndian: true), first.User.Id);
        Assert.Equal([WebAuthn.Es256, WebAuthn.Rs256], first.Algorithms);
        Assert.Equal(32, first.Challenge.Length);
        Assert.Empty(first.ExcludeCredentials);

        await AddAsync(device);
        var second = await CreationOptionsAsync();
        var excluded = Assert.Single(second.ExcludeCredentials);
        Assert.Equal(device.CredentialId, excluded.Id);
        Assert.Equal(["internal", "hybrid"], excluded.Transports); // unknown transports are dropped
    }

    [Fact]
    public async Task Adding_needs_the_password_and_a_fresh_challenge()
    {
        using var device = new FakeAuthenticator();
        var options = await CreationOptionsAsync();
        var credential = device.Create(options);

        var wrongPassword = await _client.PostJsonAsync("/api/v1/account/passkeys",
            new AddPasskeyRequest(await _client.ProofAsync("wrong password"), options.ChallengeId, null, credential));
        var reused = await _client.PostJsonAsync("/api/v1/account/passkeys",
            new AddPasskeyRequest(await _client.ProofAsync(), options.ChallengeId, null, credential));

        Assert.Contains("password", (await ReadProblemAsync(wrongPassword)).Errors.Keys);
        Assert.Contains("passkey", (await ReadProblemAsync(reused)).Errors.Keys); // the wrong try used the challenge up

        var late = await CreationOptionsAsync();
        _clock.Advance(PasskeyChallenges.Lifetime + TimeSpan.FromSeconds(1));
        var expired = await _client.PostJsonAsync("/api/v1/account/passkeys",
            new AddPasskeyRequest(await _client.ProofAsync(), late.ChallengeId, null, device.Create(late)));

        Assert.Contains("passkey", (await ReadProblemAsync(expired)).Errors.Keys);
        Assert.Empty((await _client.GetJsonAsync<List<PasskeyResponse>>("/api/v1/account/passkeys"))!);
    }

    [Theory]
    [InlineData("origin")]
    [InlineData("rpId")]
    [InlineData("unverified")]
    [InlineData("type")]
    [InlineData("idMismatch")]
    [InlineData("p384")]
    public async Task Adding_refuses_a_passkey_for_another_site_or_without_user_verification(string problem)
    {
        using var device = new FakeAuthenticator(curve: problem == "p384" ? ECCurve.NamedCurves.nistP384 : null);
        switch (problem)
        {
            case "origin": device.Origin = "https://evil.example"; break;
            case "rpId": device.RpId = "evil.example"; break;
            case "unverified": device.Verifies = false; break;
        }

        var options = await CreationOptionsAsync();
        var credential = device.Create(options, problem == "type" ? "webauthn.get" : "webauthn.create");
        if (problem == "idMismatch")
        {
            credential = credential with { Id = RandomNumberGenerator.GetBytes(16) };
        }

        var response = await _client.PostJsonAsync("/api/v1/account/passkeys",
            new AddPasskeyRequest(await _client.ProofAsync(), options.ChallengeId, null, credential));

        Assert.Contains("passkey", (await ReadProblemAsync(response)).Errors.Keys);
    }

    [Fact]
    public async Task Rsa_passkeys_work_too()
    {
        using var device = new FakeAuthenticator(WebAuthn.Rs256);
        await AddAsync(device);

        using var other = new ApiClient(_app);
        Assert.Equal(HttpStatusCode.OK, (await SignInAsync(other, device)).StatusCode);
    }

    [Fact]
    public async Task The_same_passkey_cannot_be_added_twice()
    {
        using var device = new FakeAuthenticator();
        await AddAsync(device);

        var options = await CreationOptionsAsync();
        var again = await _client.PostJsonAsync("/api/v1/account/passkeys",
            new AddPasskeyRequest(await _client.ProofAsync(), options.ChallengeId, null, device.Create(options)));

        Assert.Contains("passkey", (await ReadProblemAsync(again)).Errors.Keys);
    }

    [Fact]
    public async Task Sign_in_refuses_replays_tampering_unknown_passkeys_and_other_sites()
    {
        using var device = new FakeAuthenticator();
        await AddAsync(device);
        using var other = new ApiClient(_app);

        var options = await RequestOptionsAsync(other);
        var assertion = device.Sign(options);
        Assert.Equal(HttpStatusCode.OK, (await other.PostJsonAsync("/api/v1/auth/passkey/login",
            new PasskeyLoginRequest(options.ChallengeId, assertion))).StatusCode);
        await other.RefreshAntiforgeryTokenAsync(); // tokens are bound to the signed-in account
        Assert.Equal(HttpStatusCode.NoContent, (await other.PostAsync("/api/v1/auth/logout")).StatusCode);
        await other.RefreshAntiforgeryTokenAsync();

        var replay = await other.PostJsonAsync("/api/v1/auth/passkey/login", new PasskeyLoginRequest(options.ChallengeId, assertion));
        Assert.Equal(HttpStatusCode.Unauthorized, replay.StatusCode);

        var fresh = await RequestOptionsAsync(other);
        var tampered = device.Sign(fresh);
        tampered.Signature[^1] ^= 1;
        Assert.Equal(HttpStatusCode.Unauthorized, (await other.PostJsonAsync("/api/v1/auth/passkey/login",
            new PasskeyLoginRequest(fresh.ChallengeId, tampered))).StatusCode);

        using var stranger = new FakeAuthenticator();
        var unknown = await RequestOptionsAsync(other);
        Assert.Equal(HttpStatusCode.Unauthorized, (await other.PostJsonAsync("/api/v1/auth/passkey/login",
            new PasskeyLoginRequest(unknown.ChallengeId, stranger.Sign(unknown)))).StatusCode);

        var otherHandle = await RequestOptionsAsync(other);
        Assert.Equal(HttpStatusCode.Unauthorized, (await other.PostJsonAsync("/api/v1/auth/passkey/login",
            new PasskeyLoginRequest(otherHandle.ChallengeId, device.Sign(otherHandle) with { UserHandle = Guid.NewGuid().ToByteArray() }))).StatusCode);

        device.Origin = "https://evil.example";
        var phished = await RequestOptionsAsync(other);
        Assert.Equal(HttpStatusCode.Unauthorized, (await other.PostJsonAsync("/api/v1/auth/passkey/login",
            new PasskeyLoginRequest(phished.ChallengeId, device.Sign(phished)))).StatusCode);

        Assert.Equal(HttpStatusCode.Unauthorized, (await other.GetAsync("/api/v1/auth/me")).StatusCode);
    }

    [Fact]
    public async Task A_counter_that_goes_back_is_refused()
    {
        using var device = new FakeAuthenticator { Counter = 5 };
        await AddAsync(device);
        using var other = new ApiClient(_app);

        device.Counter = 6;
        Assert.Equal(HttpStatusCode.OK, (await SignInAsync(other, device)).StatusCode);
        device.Counter = 6; // a clone that has not seen the last use
        Assert.Equal(HttpStatusCode.Unauthorized, (await SignInAsync(new ApiClient(_app), device)).StatusCode);
    }

    [Fact]
    public async Task Passkeys_skip_the_authenticator_app_code()
    {
        var setup = (await (await _client.PostAsync("/api/v1/account/two-factor/setup")).Content
            .ReadFromJsonAsync<TwoFactorSetupResponse>(ApiClient.Json, Ct))!;
        var code = Totp.Code(Totp.FromBase32(setup.Secret)!, Totp.StepAt(_clock.GetUtcNow()));
        Assert.Equal(HttpStatusCode.OK, (await _client.PostJsonAsync("/api/v1/account/two-factor",
            new EnableTwoFactorRequest(await _client.ProofAsync(), setup.Secret, code))).StatusCode);

        using var device = new FakeAuthenticator();
        await AddAsync(device);
        using var other = new ApiClient(_app);

        Assert.Equal(HttpStatusCode.Unauthorized, (await other.LoginAsync("maple")).StatusCode); // the password alone is not enough
        Assert.Equal(HttpStatusCode.OK, (await SignInAsync(other, device)).StatusCode);
    }

    [Fact]
    public async Task A_disabled_account_cannot_sign_in_with_a_passkey()
    {
        using var member = new ApiClient(_app);
        var memberUser = await member.SignUpAsync("member");
        using var device = new FakeAuthenticator();
        await AddAsync(device, client: member);
        Assert.Equal(HttpStatusCode.NoContent, (await _client.PatchJsonAsync($"/api/v1/admin/users/{memberUser.Id}",
            new UpdateUserRequest(IsDisabled: true))).StatusCode);

        using var other = new ApiClient(_app);
        Assert.Equal(HttpStatusCode.Forbidden, (await SignInAsync(other, device)).StatusCode);
    }

    [Fact]
    public async Task Passkeys_can_be_renamed_and_removed_only_by_their_owner()
    {
        using var device = new FakeAuthenticator();
        var added = await AddAsync(device);
        using var member = new ApiClient(_app);
        await member.SignUpAsync("member");

        var renamed = await _client.PatchJsonAsync($"/api/v1/account/passkeys/{added.Id}", new RenamePasskeyRequest("  Laptop  "));
        var tooLong = await _client.PatchJsonAsync($"/api/v1/account/passkeys/{added.Id}", new RenamePasskeyRequest(new string('a', 65)));
        var notTheirs = await member.PatchJsonAsync($"/api/v1/account/passkeys/{added.Id}", new RenamePasskeyRequest("Mine"));
        var removeByOther = await member.DeleteJsonAsync($"/api/v1/account/passkeys/{added.Id}", new RemovePasskeyRequest(await member.ProofAsync()));
        var wrongPassword = await _client.DeleteJsonAsync($"/api/v1/account/passkeys/{added.Id}", new RemovePasskeyRequest(await _client.ProofAsync("nope")));

        Assert.Equal("Laptop", (await renamed.Content.ReadFromJsonAsync<PasskeyResponse>(ApiClient.Json, Ct))!.Name);
        Assert.Equal(HttpStatusCode.BadRequest, tooLong.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, notTheirs.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, removeByOther.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, wrongPassword.StatusCode);

        var removed = await _client.DeleteJsonAsync($"/api/v1/account/passkeys/{added.Id}", new RemovePasskeyRequest(await _client.ProofAsync()));
        Assert.Equal(HttpStatusCode.NoContent, removed.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await SignInAsync(new ApiClient(_app), device)).StatusCode);
    }

    [Fact]
    public async Task Default_names_count_up()
    {
        using var one = new FakeAuthenticator();
        using var two = new FakeAuthenticator();

        Assert.Equal("Passkey 1", (await AddAsync(one)).Name);
        Assert.Equal("Passkey 2", (await AddAsync(two, "   ")).Name);
    }

    [Fact]
    public async Task Deleting_the_account_deletes_its_passkeys()
    {
        using var member = new ApiClient(_app); // the only administrator cannot delete their account
        await member.SignUpAsync("member");
        using var device = new FakeAuthenticator();
        using var adminDevice = new FakeAuthenticator();
        await AddAsync(device, client: member);
        await AddAsync(adminDevice);

        using var request = new HttpRequestMessage(HttpMethod.Delete, "/api/v1/account")
        {
            Content = JsonContent.Create(new DeleteAccountRequest(await member.ProofAsync()), options: ApiClient.Json),
        };
        Assert.Equal(HttpStatusCode.NoContent, (await member.Http.SendAsync(request, Ct)).StatusCode);

        using var scope = _app.Services.CreateScope();
        var left = await scope.ServiceProvider.GetRequiredService<MapleDbContext>().Passkeys.ToListAsync(Ct);
        Assert.Equal(adminDevice.CredentialId, Assert.Single(left).CredentialId);
    }

    [Fact]
    public async Task Sign_in_options_name_no_account()
    {
        using var anonymous = new ApiClient(_app);
        var options = await RequestOptionsAsync(anonymous);

        Assert.Equal("localhost", options.RpId);
        Assert.Equal(32, options.Challenge.Length);
        Assert.Equal(PasskeyService.TimeoutMs, options.TimeoutMs);
    }

    [Fact]
    public void Challenges_are_single_use_and_bound_to_their_purpose_and_account()
    {
        var challenges = new PasskeyChallenges(_clock);
        var user = Guid.NewGuid();

        var (register, _) = challenges.Issue(PasskeyChallenges.Purpose.Register, user, "localhost", "http://localhost");
        Assert.Null(challenges.Take(register, PasskeyChallenges.Purpose.Register, Guid.NewGuid()));
        Assert.Null(challenges.Take(register, PasskeyChallenges.Purpose.Register, user)); // the wrong try removed it

        var (signIn, ceremony) = challenges.Issue(PasskeyChallenges.Purpose.SignIn, null, "localhost", "http://localhost");
        Assert.Same(ceremony, challenges.Take(signIn, PasskeyChallenges.Purpose.SignIn, null));
        Assert.Null(challenges.Take(signIn, PasskeyChallenges.Purpose.SignIn, null));
        Assert.Null(challenges.Take(null, PasskeyChallenges.Purpose.SignIn, null));
    }

    private async Task<PasskeyCreationOptions> CreationOptionsAsync(ApiClient? client = null)
    {
        var response = await (client ?? _client).PostAsync("/api/v1/account/passkeys/options");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<PasskeyCreationOptions>(ApiClient.Json, Ct))!;
    }

    private async Task<PasskeyResponse> AddAsync(FakeAuthenticator device, string? name = null, ApiClient? client = null)
    {
        client ??= _client;
        var options = await CreationOptionsAsync(client);
        var response = await client.PostJsonAsync("/api/v1/account/passkeys",
            new AddPasskeyRequest(await client.ProofAsync(), options.ChallengeId, name, device.Create(options)));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<PasskeyResponse>(ApiClient.Json, Ct))!;
    }

    private static async Task<PasskeyRequestOptions> RequestOptionsAsync(ApiClient client)
    {
        await client.RefreshAntiforgeryTokenAsync(); // a fresh visitor, or one whose token belongs to the last account
        var response = await client.PostAsync("/api/v1/auth/passkey/options");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<PasskeyRequestOptions>(ApiClient.Json, Ct))!;
    }

    private static async Task<HttpResponseMessage> SignInAsync(ApiClient client, FakeAuthenticator device)
    {
        var options = await RequestOptionsAsync(client);
        return await client.PostJsonAsync("/api/v1/auth/passkey/login", new PasskeyLoginRequest(options.ChallengeId, device.Sign(options)));
    }

    private static async Task<ValidationProblemDetails> ReadProblemAsync(HttpResponseMessage response)
    {
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<ValidationProblemDetails>(ApiClient.Json, Ct))!;
    }
}
