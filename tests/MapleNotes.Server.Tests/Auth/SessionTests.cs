using System.Net;
using System.Net.Http.Json;
using System.Security.Claims;
using MapleNotes.Server.Domain;
using MapleNotes.Server.Features.Auth;
using MapleNotes.Server.Features.EndToEnd;
using MapleNotes.Server.Infrastructure.Configuration;
using MapleNotes.Server.Infrastructure.Persistence;
using MapleNotes.Server.Tests.TestSupport;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

namespace MapleNotes.Server.Tests.Auth;

/// <summary>Server-side sessions: sign-out ends the session, the device list, and the absolute lifetime.</summary>
public sealed class SessionTests
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task A_cookie_captured_before_sign_out_is_refused_afterwards()
    {
        await using var app = new MapleAppFactory();
        using var client = new ApiClient(app);
        var cookie = SessionCookie(await client.RegisterAsync("maple"));
        using var copy = CookieClient(app, cookie);
        Assert.Equal(HttpStatusCode.OK, (await copy.GetAsync("/api/v1/auth/me", Ct)).StatusCode);

        await client.PostAsync("/api/v1/auth/logout");

        Assert.Equal(HttpStatusCode.Unauthorized, (await copy.GetAsync("/api/v1/auth/me", Ct)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await copy.GetAsync("/api/v1/auth/session-key", Ct)).StatusCode);
        Assert.Empty(await SessionsAsync(app));
    }

    [Fact]
    public async Task A_session_older_than_the_absolute_lifetime_is_refused()
    {
        await using var app = new MapleAppFactory();
        using var client = new ApiClient(app);
        await client.SignUpAsync("maple");
        var session = Assert.Single(await SessionsAsync(app));
        Assert.Equal(session.CreatedAtUtc.AddDays(90), session.ExpiresAtUtc);

        // Used every day, so the sliding (idle) limit never ends it; only the absolute lifetime does.
        await UpdateSessionAsync(app, s => s
            .SetProperty(x => x.ExpiresAtUtc, DateTime.UtcNow.AddMinutes(-1))
            .SetProperty(x => x.LastSeenAtUtc, DateTime.UtcNow));

        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/v1/auth/me")).StatusCode);
        Assert.Empty(await SessionsAsync(app));
    }

    [Fact]
    public async Task The_absolute_lifetime_can_be_configured()
    {
        await using var app = new MapleAppFactory { Settings = { [MapleOptions.SessionMaxDaysKey] = "7" } };
        using var client = new ApiClient(app);
        await client.SignUpAsync("maple");

        var session = Assert.Single(await SessionsAsync(app));
        Assert.Equal(session.CreatedAtUtc.AddDays(7), session.ExpiresAtUtc);
    }

    [Fact]
    public async Task A_session_idle_for_longer_than_the_session_length_is_refused()
    {
        await using var app = new MapleAppFactory();
        using var client = new ApiClient(app);
        await client.SignUpAsync("maple");

        await UpdateSessionAsync(app, s => s.SetProperty(x => x.LastSeenAtUtc, DateTime.UtcNow.AddDays(-31)));

        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/v1/auth/me")).StatusCode);
    }

    [Fact]
    public async Task The_device_list_shows_each_signed_in_browser_and_marks_the_current_one()
    {
        await using var app = new MapleAppFactory();
        using var laptop = new ApiClient(app);
        laptop.Http.DefaultRequestHeaders.UserAgent.ParseAdd(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0");
        await laptop.SignUpAsync("maple");
        using var phone = new ApiClient(app);
        phone.Http.DefaultRequestHeaders.UserAgent.ParseAdd(
            "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1");
        await phone.LoginAsync("maple");

        var list = await laptop.GetJsonAsync<List<SessionResponse>>("/api/v1/auth/sessions");

        Assert.Equal(2, list!.Count);
        var current = Assert.Single(list, s => s.Current);
        Assert.Equal("Firefox on Windows", current.Device);
        Assert.Equal("Safari on iOS", Assert.Single(list, s => !s.Current).Device);
        Assert.All(list, s => Assert.True(s.ExpiresAtUtc > s.LastSeenAtUtc));
    }

    [Fact]
    public async Task Signing_out_another_device_ends_only_that_session()
    {
        await using var app = new MapleAppFactory();
        using var laptop = new ApiClient(app);
        await laptop.SignUpAsync("maple");
        using var phone = new ApiClient(app);
        await phone.LoginAsync("maple");
        var phoneSession = Assert.Single((await phone.GetJsonAsync<List<SessionResponse>>("/api/v1/auth/sessions"))!, s => s.Current);

        var response = await laptop.DeleteAsync($"/api/v1/auth/sessions/{phoneSession.Id}");

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await phone.GetAsync("/api/v1/auth/me")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await laptop.GetAsync("/api/v1/auth/me")).StatusCode);
        Assert.Single((await laptop.GetJsonAsync<List<SessionResponse>>("/api/v1/auth/sessions"))!);
    }

    [Fact]
    public async Task Ending_the_current_session_from_the_list_signs_this_browser_out()
    {
        await using var app = new MapleAppFactory();
        using var client = new ApiClient(app);
        await client.SignUpAsync("maple");
        var session = Assert.Single((await client.GetJsonAsync<List<SessionResponse>>("/api/v1/auth/sessions"))!);

        var response = await client.DeleteAsync($"/api/v1/auth/sessions/{session.Id}");

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/v1/auth/me")).StatusCode);
    }

    [Fact]
    public async Task Another_accounts_session_cannot_be_listed_or_ended()
    {
        await using var app = new MapleAppFactory { Settings = { [MapleOptions.AllowRegistrationKey] = "true" } };
        using var maple = new ApiClient(app);
        await maple.SignUpAsync("maple");
        var mapleSession = Assert.Single((await maple.GetJsonAsync<List<SessionResponse>>("/api/v1/auth/sessions"))!);
        using var birch = new ApiClient(app);
        await birch.SignUpAsync("birch");

        Assert.Single((await birch.GetJsonAsync<List<SessionResponse>>("/api/v1/auth/sessions"))!);
        Assert.Equal(HttpStatusCode.NotFound, (await birch.DeleteAsync($"/api/v1/auth/sessions/{mapleSession.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await maple.GetAsync("/api/v1/auth/me")).StatusCode);
    }

    [Fact]
    public async Task A_password_change_keeps_this_session_and_removes_the_others_from_the_list()
    {
        await using var app = new MapleAppFactory();
        using var laptop = new ApiClient(app);
        await laptop.SignUpAsync("maple");
        using var phone = new ApiClient(app);
        await phone.LoginAsync("maple");
        var before = Assert.Single((await laptop.GetJsonAsync<List<SessionResponse>>("/api/v1/auth/sessions"))!, s => s.Current);

        Assert.Equal(HttpStatusCode.NoContent, (await laptop.ChangePasswordAsync(ApiClient.DefaultPassword, "a whole new password")).StatusCode);

        var after = Assert.Single((await laptop.GetJsonAsync<List<SessionResponse>>("/api/v1/auth/sessions"))!);
        Assert.Equal(before.Id, after.Id);
        Assert.True(after.Current);
        Assert.Equal(HttpStatusCode.Unauthorized, (await phone.GetAsync("/api/v1/auth/me")).StatusCode);
    }

    [Fact]
    public async Task Sign_out_everywhere_deletes_every_session()
    {
        await using var app = new MapleAppFactory();
        using var laptop = new ApiClient(app);
        await laptop.SignUpAsync("maple");
        using var phone = new ApiClient(app);
        await phone.LoginAsync("maple");

        await laptop.PostAsync("/api/v1/auth/sign-out-everywhere");

        Assert.Empty(await SessionsAsync(app));
    }

    [Fact]
    public async Task A_cookie_from_before_server_side_sessions_keeps_working_and_gets_a_session()
    {
        await using var app = new MapleAppFactory();
        using (var setup = new ApiClient(app))
        {
            await setup.SignUpAsync("maple");
            await setup.PostAsync("/api/v1/auth/logout");
        }

        User user;
        using (var scope = app.Services.CreateScope())
        {
            user = await scope.ServiceProvider.GetRequiredService<MapleDbContext>().Users.AsNoTracking().SingleAsync(Ct);
        }

        var cookieOptions = app.Services.GetRequiredService<IOptionsMonitor<CookieAuthenticationOptions>>()
            .Get(CookieAuthenticationDefaults.AuthenticationScheme);
        var legacy = new ClaimsPrincipal(new ClaimsIdentity(
            [
                new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()),
                new Claim(ClaimTypes.Name, user.Username),
                new Claim(ClaimTypes.Role, user.Role.ToString()),
                new Claim(UserPrincipal.SecurityStampClaim, user.SecurityStamp),
                new Claim(UserPrincipal.SessionKeyClaim, Convert.ToBase64String(new byte[32])),
            ],
            CookieAuthenticationDefaults.AuthenticationScheme));
        var cookie = cookieOptions.TicketDataFormat.Protect(
            new AuthenticationTicket(
                legacy,
                new AuthenticationProperties
                {
                    IssuedUtc = DateTimeOffset.UtcNow.AddDays(-20), ExpiresUtc = DateTimeOffset.UtcNow.AddDays(10), AllowRefresh = true,
                },
                CookieAuthenticationDefaults.AuthenticationScheme));
        using var http = CookieClient(app, cookie);

        var response = await http.GetAsync("/api/v1/auth/session-key", Ct);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(new byte[32], (await response.Content.ReadFromJsonAsync<SessionKeyResponse>(ApiClient.Json, Ct))!.Key);
        Assert.Single(await SessionsAsync(app));
        Assert.Contains(response.Headers.GetValues("Set-Cookie"), c => c.StartsWith("maple.session=", StringComparison.Ordinal));
    }

    [Theory]
    [InlineData("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0", "Edge on Windows")]
    [InlineData("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15", "Safari on macOS")]
    [InlineData("Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36", "Chrome on Android")]
    [InlineData("Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0", "Firefox on Linux")]
    [InlineData("FalconNotes/2.1 (+https://example.org)", "FalconNotes")]
    [InlineData("", "Unknown device")]
    public void Devices_are_described_by_browser_and_system(string userAgent, string expected) =>
        Assert.Equal(expected, DeviceDescription.FromUserAgent(userAgent));

    private static string SessionCookie(HttpResponseMessage response)
    {
        response.EnsureSuccessStatusCode();
        var header = Assert.Single(response.Headers.GetValues("Set-Cookie"), c => c.StartsWith("maple.session=", StringComparison.Ordinal));
        return header.Split(';')[0]["maple.session=".Length..];
    }

    private static HttpClient CookieClient(MapleAppFactory app, string cookie)
    {
        var http = app.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = false });
        http.DefaultRequestHeaders.Add("Cookie", $"maple.session={cookie}");
        return http;
    }

    private static async Task<List<Session>> SessionsAsync(MapleAppFactory app)
    {
        using var scope = app.Services.CreateScope();
        return await scope.ServiceProvider.GetRequiredService<MapleDbContext>().Sessions.AsNoTracking().ToListAsync(Ct);
    }

    private static async Task UpdateSessionAsync(
        MapleAppFactory app,
        Action<Microsoft.EntityFrameworkCore.Query.UpdateSettersBuilder<Session>> update)
    {
        using var scope = app.Services.CreateScope();
        await scope.ServiceProvider.GetRequiredService<MapleDbContext>().Sessions.ExecuteUpdateAsync(update, Ct);
    }
}
