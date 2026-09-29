using System.Buffers.Binary;
using System.Net;
using System.Net.Http.Json;
using MapleNotes.Server.Domain;
using MapleNotes.Server.Features.Admin;
using MapleNotes.Server.Features.Auth;
using MapleNotes.Server.Infrastructure.Configuration;
using MapleNotes.Server.Infrastructure.Persistence;
using MapleNotes.Server.Tests.TestSupport;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace MapleNotes.Server.Tests.Auth;

public sealed class AuthTests
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task Fresh_instance_requires_setup_and_the_first_account_becomes_administrator()
    {
        await using var app = new MapleAppFactory();
        using var client = new ApiClient(app);

        var before = await client.GetJsonAsync<AuthStatusResponse>("/api/v1/auth/status");
        var user = await client.SignUpAsync("maple");
        var after = await client.GetJsonAsync<AuthStatusResponse>("/api/v1/auth/status");

        Assert.True(before!.SetupRequired);
        Assert.True(before.RegistrationOpen);
        Assert.Null(before.User);
        Assert.Equal(UserRole.Admin, user.Role);
        Assert.True(user.EncryptionEnabled);
        Assert.False(after!.SetupRequired);
        Assert.Equal("maple", after.User!.Username);
    }

    [Fact]
    public async Task Registration_is_closed_after_the_first_account_until_an_administrator_opens_it()
    {
        await using var app = new MapleAppFactory();
        using var admin = new ApiClient(app);
        using var visitor = new ApiClient(app);
        await admin.SignUpAsync("admin");

        var refused = await visitor.RegisterAsync("visitor");
        (await admin.PutJsonAsync("/api/v1/admin/settings", new UpdateInstanceSettingsRequest(AllowRegistration: true))).EnsureSuccessStatusCode();
        var accepted = await visitor.RegisterAsync("visitor");

        Assert.Equal(HttpStatusCode.Forbidden, refused.StatusCode);
        Assert.Equal(HttpStatusCode.Created, accepted.StatusCode);
        Assert.Equal(UserRole.User, (await accepted.Content.ReadFromJsonAsync<UserResponse>(ApiClient.Json, Ct))!.Role);
    }

    [Fact]
    public async Task Environment_can_open_registration_from_the_start()
    {
        await using var app = new MapleAppFactory { Settings = { [MapleOptions.AllowRegistrationKey] = "true" } };
        using var first = new ApiClient(app);
        using var second = new ApiClient(app);

        await first.SignUpAsync("first");
        var response = await second.RegisterAsync("second");

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    }

    [Fact]
    public async Task Usernames_are_unique_ignoring_case()
    {
        await using var app = OpenRegistration();
        using var client = new ApiClient(app);
        await client.SignUpAsync("Maple");

        using var other = new ApiClient(app);
        var response = await other.RegisterAsync("mAPLE");

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
    }

    [Theory]
    [InlineData("ab")]
    [InlineData("has space")]
    [InlineData("-leading")]
    public async Task Invalid_usernames_are_rejected_with_field_errors(string username)
    {
        await using var app = new MapleAppFactory();
        using var client = new ApiClient(app);

        var response = await client.RegisterAsync(username);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<ValidationProblemDetails>(ApiClient.Json, Ct);
        Assert.Contains("username", problem!.Errors.Keys);
    }

    [Fact]
    public async Task Sign_in_sets_an_http_only_same_site_strict_session_cookie()
    {
        await using var app = new MapleAppFactory();
        using var setup = new ApiClient(app);
        await setup.SignUpAsync("maple");

        using var client = new ApiClient(app);
        var response = await client.LoginAsync("MAPLE");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var cookie = Assert.Single(response.Headers.GetValues("Set-Cookie"), c => c.StartsWith("maple.session=", StringComparison.Ordinal));
        Assert.Contains("httponly", cookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("samesite=strict", cookie, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("expires", cookie, StringComparison.OrdinalIgnoreCase); // not "remember me": ends with the browser session
    }

    [Fact]
    public async Task Remember_me_makes_the_session_persistent()
    {
        await using var app = new MapleAppFactory();
        using var setup = new ApiClient(app);
        await setup.SignUpAsync("maple");

        using var client = new ApiClient(app);
        var response = await client.LoginAsync("maple", rememberMe: true);

        var cookie = Assert.Single(response.Headers.GetValues("Set-Cookie"), c => c.StartsWith("maple.session=", StringComparison.Ordinal));
        Assert.Contains("expires", cookie, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Wrong_password_and_unknown_user_get_the_same_answer()
    {
        await using var app = new MapleAppFactory();
        using var client = new ApiClient(app);
        await client.SignUpAsync("maple");

        var wrongPassword = await client.LoginAsync("maple", "not the right password");
        var unknownUser = await client.LoginAsync("nobody", "not the right password");

        Assert.Equal(HttpStatusCode.Unauthorized, wrongPassword.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, unknownUser.StatusCode);
        Assert.Equal(
            (await wrongPassword.Content.ReadFromJsonAsync<ProblemDetails>(ApiClient.Json, Ct))!.Title,
            (await unknownUser.Content.ReadFromJsonAsync<ProblemDetails>(ApiClient.Json, Ct))!.Title);
    }

    [Fact]
    public async Task Account_locks_after_five_failed_attempts()
    {
        await using var app = new MapleAppFactory();
        using var client = new ApiClient(app);
        await client.SignUpAsync("maple");

        for (var i = 0; i < AccountService.MaxFailedAttempts - 1; i++)
        {
            Assert.Equal(HttpStatusCode.Unauthorized, (await client.LoginAsync("maple", "wrong password!!")).StatusCode);
        }

        var fifth = await client.LoginAsync("maple", "wrong password!!");
        var correctButLocked = await client.LoginAsync("maple");

        Assert.Equal(HttpStatusCode.TooManyRequests, fifth.StatusCode);
        Assert.Equal(HttpStatusCode.TooManyRequests, correctButLocked.StatusCode);
        Assert.True(correctButLocked.Headers.RetryAfter?.Delta > TimeSpan.FromMinutes(14));
    }

    [Fact]
    public async Task Api_requires_sign_in()
    {
        await using var app = new MapleAppFactory();
        using var client = new ApiClient(app);

        var response = await client.GetAsync("/api/v1/auth/me");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task State_changing_requests_require_the_antiforgery_token()
    {
        await using var app = new MapleAppFactory();
        using var client = new ApiClient(app);
        await client.SignUpAsync("maple");

        client.Http.DefaultRequestHeaders.Remove("X-XSRF-TOKEN");
        var withoutToken = await client.PostAsync("/api/v1/auth/logout");
        await client.RefreshAntiforgeryTokenAsync();
        var withToken = await client.PostAsync("/api/v1/auth/logout");

        Assert.Equal(HttpStatusCode.BadRequest, withoutToken.StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, withToken.StatusCode);
    }

    [Fact]
    public async Task Logout_ends_the_session()
    {
        await using var app = new MapleAppFactory();
        using var client = new ApiClient(app);
        await client.SignUpAsync("maple");

        await client.PostAsync("/api/v1/auth/logout");

        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/v1/auth/me")).StatusCode);
    }

    [Fact]
    public async Task Changing_the_password_signs_out_other_sessions_but_keeps_this_one()
    {
        await using var app = new MapleAppFactory();
        using var laptop = new ApiClient(app);
        using var phone = new ApiClient(app);
        await laptop.SignUpAsync("maple");
        await phone.LoginAsync("maple");

        var change = await laptop.ChangePasswordAsync(ApiClient.DefaultPassword, "a brand new passphrase");

        Assert.Equal(HttpStatusCode.NoContent, change.StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await laptop.GetAsync("/api/v1/auth/me")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await phone.GetAsync("/api/v1/auth/me")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await phone.LoginAsync("maple")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await phone.LoginAsync("maple", "a brand new passphrase")).StatusCode);
    }

    [Fact]
    public async Task Changing_the_password_requires_the_current_one()
    {
        await using var app = new MapleAppFactory();
        using var client = new ApiClient(app);
        await client.SignUpAsync("maple");

        var response = await client.ChangePasswordAsync("a guessed password", "a brand new passphrase");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<ValidationProblemDetails>(ApiClient.Json, Ct);
        Assert.Contains("currentPassword", problem!.Errors.Keys);
    }

    [Fact]
    public async Task Sign_out_everywhere_ends_every_session()
    {
        await using var app = new MapleAppFactory();
        using var laptop = new ApiClient(app);
        using var phone = new ApiClient(app);
        await laptop.SignUpAsync("maple");
        await phone.LoginAsync("maple");

        await laptop.PostAsync("/api/v1/auth/sign-out-everywhere");

        Assert.Equal(HttpStatusCode.Unauthorized, (await laptop.GetAsync("/api/v1/auth/me")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await phone.GetAsync("/api/v1/auth/me")).StatusCode);
    }

    [Fact]
    public async Task Credentials_are_stored_as_pbkdf2_sha512_hashes_of_the_authentication_key()
    {
        await using var app = new MapleAppFactory();
        using var client = new ApiClient(app);
        await client.SignUpAsync("maple");

        using var scope = app.Services.CreateScope();
        var user = await scope.ServiceProvider.GetRequiredService<MapleDbContext>().Users.SingleAsync(Ct);
        var hasher = scope.ServiceProvider.GetRequiredService<IPasswordHasher<User>>();
        var hash = Convert.FromBase64String(user.CredentialHash);
        var authKey = ApiClient.DeriveKeys(ApiClient.DefaultPassword, ApiClient.TestKdf()).AuthKey;

        Assert.Equal(0x01, hash[0]);                                                  // Identity V3 format
        Assert.Equal(2u, BinaryPrimitives.ReadUInt32BigEndian(hash.AsSpan(1, 4)));    // HMAC-SHA512
        Assert.Equal(210_000u, BinaryPrimitives.ReadUInt32BigEndian(hash.AsSpan(5, 4)));
        Assert.Equal(CredentialFormat.AuthKey, user.CredentialFormat);
        Assert.Equal(PasswordVerificationResult.Success,
            hasher.VerifyHashedPassword(user, user.CredentialHash, Convert.ToBase64String(authKey)));
        Assert.Equal(PasswordVerificationResult.Failed,
            hasher.VerifyHashedPassword(user, user.CredentialHash, ApiClient.DefaultPassword));
    }

    private static MapleAppFactory OpenRegistration() =>
        new() { Settings = { [MapleOptions.AllowRegistrationKey] = "true" } };
}
