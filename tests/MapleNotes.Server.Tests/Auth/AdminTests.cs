using System.Net;
using MapleNotes.Server.Domain;
using MapleNotes.Server.Features.Admin;
using MapleNotes.Server.Features.Auth;
using MapleNotes.Server.Infrastructure.Configuration;
using MapleNotes.Server.Tests.TestSupport;

namespace MapleNotes.Server.Tests.Auth;

public sealed class AdminTests : IAsyncLifetime
{
    private readonly MapleAppFactory _app = new() { Settings = { [MapleOptions.AllowRegistrationKey] = "true" } };
    private ApiClient _admin = null!;
    private ApiClient _member = null!;
    private UserResponse _adminUser = null!;
    private UserResponse _memberUser = null!;

    public async ValueTask InitializeAsync()
    {
        _admin = new ApiClient(_app);
        _member = new ApiClient(_app);
        _adminUser = await _admin.SignUpAsync("admin");
        _memberUser = await _member.SignUpAsync("member");
    }

    [Fact]
    public async Task Members_cannot_use_admin_endpoints()
    {
        Assert.Equal(HttpStatusCode.Forbidden, (await _member.GetAsync("/api/v1/admin/users")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,
            (await _member.PutJsonAsync("/api/v1/admin/settings", new UpdateInstanceSettingsRequest(true))).StatusCode);
    }

    [Fact]
    public async Task Session_length_is_kept_and_checked()
    {
        Assert.Equal(30, (await _admin.GetJsonAsync<InstanceSettingsResponse>("/api/v1/admin/settings"))!.SessionDays);

        var saved = await _admin.PutJsonAsync("/api/v1/admin/settings", new UpdateInstanceSettingsRequest(true, SessionDays: 365));
        var tooLong = await _admin.PutJsonAsync("/api/v1/admin/settings", new UpdateInstanceSettingsRequest(true, SessionDays: 401));
        var tooShort = await _admin.PutJsonAsync("/api/v1/admin/settings", new UpdateInstanceSettingsRequest(true, SessionDays: 0));

        Assert.Equal(HttpStatusCode.OK, saved.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, tooLong.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, tooShort.StatusCode);
        Assert.Equal(365, (await _admin.GetJsonAsync<InstanceSettingsResponse>("/api/v1/admin/settings"))!.SessionDays);
    }

    [Fact]
    public async Task Lists_accounts_without_note_content()
    {
        var users = await _admin.GetJsonAsync<List<AdminUserResponse>>("/api/v1/admin/users");

        Assert.Equal(["admin", "member"], users!.Select(u => u.Username));
        Assert.All(users!, u => Assert.Equal(0, u.NoteCount));
    }

    [Fact]
    public async Task Disabling_an_account_signs_it_out_and_blocks_sign_in()
    {
        var response = await _admin.PatchJsonAsync($"/api/v1/admin/users/{_memberUser.Id}", new UpdateUserRequest(IsDisabled: true));

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await _member.GetAsync("/api/v1/auth/me")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await _member.LoginAsync("member")).StatusCode);

        await _admin.PatchJsonAsync($"/api/v1/admin/users/{_memberUser.Id}", new UpdateUserRequest(IsDisabled: false));
        Assert.Equal(HttpStatusCode.OK, (await _member.LoginAsync("member")).StatusCode);
    }

    [Fact]
    public async Task Promotion_applies_to_the_existing_session()
    {
        await _admin.PatchJsonAsync($"/api/v1/admin/users/{_memberUser.Id}", new UpdateUserRequest(Role: UserRole.Admin));

        Assert.Equal(HttpStatusCode.OK, (await _member.GetAsync("/api/v1/admin/users")).StatusCode);
    }

    [Fact]
    public async Task Administrators_cannot_lock_themselves_out()
    {
        var disable = await _admin.PatchJsonAsync($"/api/v1/admin/users/{_adminUser.Id}", new UpdateUserRequest(IsDisabled: true));
        var demote = await _admin.PatchJsonAsync($"/api/v1/admin/users/{_adminUser.Id}", new UpdateUserRequest(Role: UserRole.User));

        Assert.Equal(HttpStatusCode.Conflict, disable.StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, demote.StatusCode);
    }

    [Fact]
    public async Task Unknown_roles_are_refused()
    {
        // JSON accepts any number for an enum; 7 is no role, and would have demoted the administrator.
        var response = await _admin.PatchJsonAsync($"/api/v1/admin/users/{_adminUser.Id}", new { role = 7 });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await _admin.GetAsync("/api/v1/admin/users")).StatusCode);
    }

    [Fact]
    public async Task Unknown_accounts_return_404()
    {
        var response = await _admin.PatchJsonAsync($"/api/v1/admin/users/{Guid.CreateVersion7()}", new UpdateUserRequest(IsDisabled: true));

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    public async ValueTask DisposeAsync()
    {
        _admin.Dispose();
        _member.Dispose();
        await _app.DisposeAsync();
    }
}
