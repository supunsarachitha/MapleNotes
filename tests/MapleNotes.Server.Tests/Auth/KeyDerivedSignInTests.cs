using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using MapleNotes.Server.Domain;
using MapleNotes.Server.Features.Auth;
using MapleNotes.Server.Features.Encryption;
using MapleNotes.Server.Infrastructure.Configuration;
using MapleNotes.Server.Infrastructure.Persistence;
using MapleNotes.Server.Tests.TestSupport;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace MapleNotes.Server.Tests.Auth;

/// <summary>
/// Key-derived sign-in (docs/e2ee-spec.md §1): the browser sends a key derived from the password, never the password,
/// and prelogin does not reveal which usernames exist.
/// </summary>
public sealed class KeyDerivedSignInTests
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task Prelogin_returns_the_parameters_the_account_registered_with()
    {
        await using var app = new MapleAppFactory();
        using var client = new ApiClient(app);
        await client.SignUpAsync("maple");

        var prelogin = await client.PreloginAsync("MAPLE");

        var expected = ApiClient.TestKdf();
        Assert.Equal(expected.Salt, prelogin.Kdf.Salt);
        Assert.Equal((expected.MemoryKiB, expected.Iterations, expected.Parallelism),
            (prelogin.Kdf.MemoryKiB, prelogin.Kdf.Iterations, prelogin.Kdf.Parallelism));
        Assert.False(prelogin.Upgrade);
    }

    [Fact]
    public async Task Prelogin_answers_for_an_unknown_username_like_for_a_real_account()
    {
        await using var app = new MapleAppFactory();
        using var client = new ApiClient(app);
        var defaults = new KdfParameters(
            RandomNumberGenerator.GetBytes(KeyDerivation.SaltBytes),
            KeyDerivation.DefaultMemoryKiB, KeyDerivation.DefaultIterations, KeyDerivation.DefaultParallelism);
        await client.RefreshAntiforgeryTokenAsync();
        (await client.PostJsonAsync("/api/v1/auth/register",
            new RegisterRequest("maple", defaults, RandomNumberGenerator.GetBytes(32)))).EnsureSuccessStatusCode();
        await client.RefreshAntiforgeryTokenAsync(); // now signed in

        var real = await client.PreloginAsync("maple");
        var unknown = await client.PreloginAsync("nobody");

        Assert.Equal(Shape(real), Shape(unknown));
        Assert.NotEqual(real.Kdf.Salt, unknown.Kdf.Salt);

        static object Shape(PreloginResponse r) =>
            (r.Kdf.Salt.Length, r.Kdf.MemoryKiB, r.Kdf.Iterations, r.Kdf.Parallelism, r.Upgrade);
    }

    [Fact]
    public async Task Pseudo_salts_are_stable_ignore_case_and_differ_between_usernames_and_instances()
    {
        await using var app = new MapleAppFactory();
        await using var otherInstance = new MapleAppFactory();
        using var client = new ApiClient(app);
        using var otherClient = new ApiClient(otherInstance);
        await client.RefreshAntiforgeryTokenAsync();
        await otherClient.RefreshAntiforgeryTokenAsync();

        var first = (await client.PreloginAsync("nobody")).Kdf.Salt;
        var again = (await client.PreloginAsync(" NoBody ")).Kdf.Salt;
        var otherName = (await client.PreloginAsync("somebody")).Kdf.Salt;
        var otherKey = (await otherClient.PreloginAsync("nobody")).Kdf.Salt;

        Assert.Equal(first, again);
        Assert.NotEqual(first, otherName);
        Assert.NotEqual(first, otherKey);
    }

    [Theory]
    [InlineData(KeyDerivation.MinMemoryKiB - 1, 3, 1, 16)]
    [InlineData(KeyDerivation.MaxMemoryKiB + 1, 3, 1, 16)]
    [InlineData(65536, KeyDerivation.MinIterations - 1, 1, 16)]
    [InlineData(65536, KeyDerivation.MaxIterations + 1, 1, 16)]
    [InlineData(65536, 3, 0, 16)]
    [InlineData(65536, 3, KeyDerivation.MaxParallelism + 1, 16)]
    [InlineData(65536, 3, 1, 8)]
    public async Task Registration_refuses_unsafe_key_derivation_parameters(int memoryKiB, int iterations, int parallelism, int saltBytes)
    {
        await using var app = new MapleAppFactory();
        using var client = new ApiClient(app);
        await client.RefreshAntiforgeryTokenAsync();

        var response = await client.PostJsonAsync("/api/v1/auth/register", new RegisterRequest(
            "maple", new KdfParameters(new byte[saltBytes], memoryKiB, iterations, parallelism), new byte[32]));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("kdf", (await response.Content.ReadFromJsonAsync<ValidationProblemDetails>(ApiClient.Json, Ct))!.Errors.Keys);
    }

    [Fact]
    public async Task Malformed_authentication_keys_are_refused_the_same_way_for_every_username()
    {
        await using var app = new MapleAppFactory();
        using var client = new ApiClient(app);
        await client.SignUpAsync("maple");
        await client.PostAsync("/api/v1/auth/logout");
        await client.RefreshAntiforgeryTokenAsync();

        var register = await client.PostJsonAsync("/api/v1/auth/register", new RegisterRequest("other", ApiClient.TestKdf(), new byte[16]));
        var known = await client.PostJsonAsync("/api/v1/auth/login", new LoginRequest("maple", new byte[16]));
        var unknown = await client.PostJsonAsync("/api/v1/auth/login", new LoginRequest("nobody", new byte[16]));

        foreach (var response in new[] { register, known, unknown })
        {
            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
            Assert.Contains("authKey", (await response.Content.ReadFromJsonAsync<ValidationProblemDetails>(ApiClient.Json, Ct))!.Errors.Keys);
        }
    }

    [Fact]
    public async Task The_password_is_no_substitute_for_the_authentication_key()
    {
        await using var app = new MapleAppFactory();
        using var client = new ApiClient(app);
        await client.SignUpAsync("maple");
        await client.PostAsync("/api/v1/auth/logout");
        await client.RefreshAntiforgeryTokenAsync();

        var response = await client.PostJsonAsync("/api/v1/auth/login",
            new LoginRequest("maple", RandomNumberGenerator.GetBytes(32), Password: ApiClient.DefaultPassword));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Changing_the_password_replaces_the_salt_and_the_key()
    {
        await using var app = new MapleAppFactory();
        using var client = new ApiClient(app);
        await client.SignUpAsync("maple");

        (await client.ChangePasswordAsync(ApiClient.DefaultPassword, "a brand new passphrase")).EnsureSuccessStatusCode();

        Assert.Equal(ApiClient.TestKdf("a brand new passphrase").Salt, (await client.PreloginAsync("maple")).Kdf.Salt);
        using var other = new ApiClient(app);
        Assert.Equal(HttpStatusCode.Unauthorized, (await other.LoginAsync("maple")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await other.LoginAsync("maple", "a brand new passphrase")).StatusCode);
    }

    [Fact]
    public async Task A_legacy_account_upgrades_at_its_next_sign_in()
    {
        await using var app = new MapleAppFactory();
        using var setup = new ApiClient(app);
        await setup.SignUpAsync("maple");
        await MakeLegacyAsync(app, "maple", ApiClient.DefaultPassword);
        using var client = new ApiClient(app);
        await client.RefreshAntiforgeryTokenAsync();

        var prelogin = await client.PreloginAsync("maple");
        var authKey = ApiClient.DeriveKeys(ApiClient.DefaultPassword, prelogin.Kdf).AuthKey;
        var withoutPassword = await client.PostJsonAsync("/api/v1/auth/login", new LoginRequest("maple", authKey));
        var upgraded = await client.LoginAsync("maple");

        Assert.True(prelogin.Upgrade);
        Assert.Equal(HttpStatusCode.Unauthorized, withoutPassword.StatusCode);
        Assert.Equal(HttpStatusCode.OK, upgraded.StatusCode);
        Assert.False((await client.PreloginAsync("maple")).Upgrade);
        Assert.True(await HoldsAuthKeyAsync(app, "maple", authKey));

        using var next = new ApiClient(app); // signs in without sending the password: prelogin no longer asks for it
        Assert.Equal(HttpStatusCode.OK, (await next.LoginAsync("maple")).StatusCode);
    }

    [Fact]
    public async Task A_wrong_password_neither_signs_in_nor_upgrades_a_legacy_account()
    {
        await using var app = new MapleAppFactory();
        using var setup = new ApiClient(app);
        await setup.SignUpAsync("maple");
        await MakeLegacyAsync(app, "maple", ApiClient.DefaultPassword);
        using var client = new ApiClient(app);

        var response = await client.LoginAsync("maple", "not the right password");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        await client.RefreshAntiforgeryTokenAsync();
        Assert.True((await client.PreloginAsync("maple")).Upgrade);
        using var scope = app.Services.CreateScope();
        Assert.Equal(1, (await scope.ServiceProvider.GetRequiredService<MapleDbContext>().Users.SingleAsync(Ct)).AccessFailedCount);
    }

    [Fact]
    public async Task Confirming_the_password_upgrades_a_signed_in_legacy_account()
    {
        await using var app = new MapleAppFactory();
        using var client = new ApiClient(app);
        await client.SignUpAsync("maple"); // stays signed in, as a 1.0 session would across the update
        await MakeLegacyAsync(app, "maple", ApiClient.DefaultPassword);

        var proof = await client.ProofAsync();
        var response = await client.PutJsonAsync("/api/v1/account/encryption", new UpdateEncryptionRequest(EncryptionMode.Off, proof));

        Assert.Equal(ApiClient.DefaultPassword, proof.Password);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.True(await HoldsAuthKeyAsync(app, "maple", proof.AuthKey));
    }

    [Fact]
    public async Task Prelogin_has_its_own_rate_limit()
    {
        await using var app = new MapleAppFactory { Settings = { [MapleOptions.AuthenticationRateLimitKey] = "2" } };
        using var client = new ApiClient(app);
        await client.SignUpAsync("maple"); // one authentication request
        await client.PostAsync("/api/v1/auth/logout");
        await client.RefreshAntiforgeryTokenAsync();

        await client.PreloginAsync("maple");
        await client.PreloginAsync("maple");
        var third = await client.PostJsonAsync("/api/v1/auth/prelogin", new PreloginRequest("maple"));
        var login = await client.PostJsonAsync("/api/v1/auth/login",
            new LoginRequest("maple", ApiClient.DeriveKeys(ApiClient.DefaultPassword, ApiClient.TestKdf()).AuthKey));

        Assert.Equal(HttpStatusCode.TooManyRequests, third.StatusCode);
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
    }

    /// <summary>Turns an account into what version 1.0 left behind, as migrated by <c>KeyDerivedSignIn</c>.</summary>
    private static async Task MakeLegacyAsync(MapleAppFactory app, string username, string password)
    {
        using var scope = app.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<MapleDbContext>();
        var user = await db.Users.SingleAsync(u => u.NormalizedUsername == username.ToUpperInvariant(), Ct);
        user.CredentialHash = scope.ServiceProvider.GetRequiredService<IPasswordHasher<User>>().HashPassword(user, password);
        user.CredentialFormat = CredentialFormat.LegacyPassword;
        user.KdfSalt = RandomNumberGenerator.GetBytes(KeyDerivation.SaltBytes);
        await db.SaveChangesAsync(Ct);
    }

    private static async Task<bool> HoldsAuthKeyAsync(MapleAppFactory app, string username, byte[] authKey)
    {
        using var scope = app.Services.CreateScope();
        var user = await scope.ServiceProvider.GetRequiredService<MapleDbContext>().Users
            .SingleAsync(u => u.NormalizedUsername == username.ToUpperInvariant(), Ct);
        var hasher = scope.ServiceProvider.GetRequiredService<IPasswordHasher<User>>();
        return user.CredentialFormat == CredentialFormat.AuthKey
            && hasher.VerifyHashedPassword(user, user.CredentialHash, Convert.ToBase64String(authKey)) == PasswordVerificationResult.Success;
    }
}
