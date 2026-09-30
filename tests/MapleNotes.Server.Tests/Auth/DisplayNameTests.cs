using System.Net;
using System.Net.Http.Json;
using MapleNotes.Server.Features.Auth;
using MapleNotes.Server.Features.Encryption;
using MapleNotes.Server.Infrastructure.Configuration;
using MapleNotes.Server.Tests.TestSupport;
using Microsoft.AspNetCore.Mvc;

namespace MapleNotes.Server.Tests.Auth;

/// <summary>Each account changes the name the app shows for it; an empty name goes back to the username.</summary>
public sealed class DisplayNameTests : IAsyncLifetime
{
    private readonly MapleAppFactory _app = new() { Settings = { [MapleOptions.AllowRegistrationKey] = "true" } };
    private ApiClient _member = null!;
    private ApiClient _other = null!;

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    public async ValueTask InitializeAsync()
    {
        _other = new ApiClient(_app);
        _member = new ApiClient(_app);
        await _other.SignUpAsync("other");
        await _member.SignUpAsync("member");
    }

    public async ValueTask DisposeAsync()
    {
        _member.Dispose();
        _other.Dispose();
        await _app.DisposeAsync();
    }

    [Fact]
    public async Task The_display_name_changes_for_this_account_only()
    {
        var response = await _member.PutJsonAsync("/api/v1/account/display-name", new ChangeDisplayNameRequest("  Alex Maple  "));

        Assert.Equal("Alex Maple", (await response.Content.ReadFromJsonAsync<UserResponse>(ApiClient.Json, Ct))!.DisplayName);
        Assert.Equal("Alex Maple", (await _member.GetJsonAsync<UserResponse>("/api/v1/auth/me"))!.DisplayName);
        Assert.Equal("other", (await _other.GetJsonAsync<UserResponse>("/api/v1/auth/me"))!.DisplayName);

        await _member.PutJsonAsync("/api/v1/account/display-name", new ChangeDisplayNameRequest(" "));
        Assert.Equal("member", (await _member.GetJsonAsync<UserResponse>("/api/v1/auth/me"))!.DisplayName); // the username again
    }

    [Theory]
    [InlineData("A name much too long to show anywhere in the menu, the account list or the settings")]
    [InlineData("Two\nlines")]
    public async Task Names_that_do_not_fit_on_one_line_are_refused(string name)
    {
        var response = await _member.PutJsonAsync("/api/v1/account/display-name", new ChangeDisplayNameRequest(name));

        Assert.Contains("displayName", (await response.Content.ReadFromJsonAsync<ValidationProblemDetails>(Ct))!.Errors.Keys);
        Assert.Equal("member", (await _member.GetJsonAsync<UserResponse>("/api/v1/auth/me"))!.DisplayName);
    }

    [Fact]
    public async Task Visitors_cannot_change_names()
    {
        using var visitor = new ApiClient(_app);
        await visitor.RefreshAntiforgeryTokenAsync();

        Assert.Equal(HttpStatusCode.Unauthorized, (await visitor.PutJsonAsync("/api/v1/account/display-name", new ChangeDisplayNameRequest("x"))).StatusCode);
    }
}
