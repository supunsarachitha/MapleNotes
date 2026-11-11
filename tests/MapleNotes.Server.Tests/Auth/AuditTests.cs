using System.Net;
using MapleNotes.Server.Domain;
using MapleNotes.Server.Features.Admin;
using MapleNotes.Server.Features.Audit;
using MapleNotes.Server.Features.Auth;
using MapleNotes.Server.Infrastructure.Configuration;
using MapleNotes.Server.Tests.TestSupport;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace MapleNotes.Server.Tests.Auth;

public sealed class AuditTests : IAsyncLifetime
{
    private readonly MapleAppFactory _app = new() { Settings = { [MapleOptions.AllowRegistrationKey] = "true" } };
    private ApiClient _admin = null!;
    private ApiClient _member = null!;
    private UserResponse _memberUser = null!;

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    public async ValueTask InitializeAsync()
    {
        _admin = new ApiClient(_app);
        _member = new ApiClient(_app);
        await _admin.SignUpAsync("admin");
        _memberUser = await _member.SignUpAsync("member");
    }

    public async ValueTask DisposeAsync()
    {
        _admin.Dispose();
        _member.Dispose();
        await _app.DisposeAsync();
    }

    private Task<AuditPageResponse?> ListAsync(string query = "") => _admin.GetJsonAsync<AuditPageResponse>($"/api/v1/admin/audit{query}");

    [Fact]
    public async Task Records_sign_ins_and_refused_ones_by_the_username_given()
    {
        using var visitor = new ApiClient(_app);
        Assert.Equal(HttpStatusCode.Unauthorized, (await visitor.LoginAsync("member", "wrong password")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await visitor.LoginAsync("nobody")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await visitor.LoginAsync("member")).StatusCode);

        var page = (await ListAsync("?filter=SignIns"))!;
        Assert.Equal(
            [(AuditEvent.SignIn, "member"), (AuditEvent.SignInFailed, "nobody"), (AuditEvent.SignInFailed, "member")],
            page.Items.Take(3).Select(e => (e.Event, e.Username)));
        Assert.All(page.Items.Take(3), e => Assert.Equal("Password", e.Method));
        Assert.Equal("Wrong username or password.", page.Items[1].Detail);
        Assert.Equal([AuditEvent.SignInFailed, AuditEvent.SignInFailed], (await ListAsync("?filter=FailedSignIns"))!.Items.Select(e => e.Event));
    }

    [Fact]
    public async Task Records_what_administrators_change()
    {
        (await _admin.PutJsonAsync("/api/v1/admin/settings", new UpdateInstanceSettingsRequest(false, SessionDays: 14))).EnsureSuccessStatusCode();
        (await _admin.PutJsonAsync("/api/v1/admin/settings", new UpdateInstanceSettingsRequest(false, SessionDays: 14))).EnsureSuccessStatusCode(); // no change
        (await _admin.PatchJsonAsync($"/api/v1/admin/users/{_memberUser.Id}", new UpdateUserRequest(IsDisabled: true, Role: UserRole.Admin))).EnsureSuccessStatusCode();
        (await _admin.DeleteAsync($"/api/v1/admin/users/{_memberUser.Id}")).EnsureSuccessStatusCode();

        var entries = (await ListAsync("?filter=Admin"))!.Items;
        Assert.Equal([AuditEvent.AccountDeleted, AuditEvent.AccountChanged, AuditEvent.SettingsChanged], entries.Select(e => e.Event));
        Assert.All(entries, e => Assert.Equal("admin", e.Username));
        Assert.Equal("member", entries[0].TargetUsername); // still named after the account is gone
        Assert.Equal("Disabled the account (and signed it out everywhere). Role: User → Admin.", entries[1].Detail);
        Assert.Equal("Registration: open → closed. Sessions last: 30 → 14 days.", entries[2].Detail);
    }

    [Fact]
    public async Task Only_administrators_see_it_a_page_at_a_time_and_old_entries_go()
    {
        Assert.Equal(HttpStatusCode.Forbidden, (await _member.GetAsync("/api/v1/admin/audit")).StatusCode);

        using var visitor = new ApiClient(_app);
        for (var i = 0; i < 3; i++)
        {
            await visitor.LoginAsync("member", "wrong password");
        }

        var first = (await ListAsync("?filter=FailedSignIns&limit=2"))!;
        Assert.Equal(2, first.Items.Count);
        var rest = (await ListAsync($"?filter=FailedSignIns&limit=2&before={first.NextCursor}"))!;
        Assert.Single(rest.Items);
        Assert.Null(rest.NextCursor);

        using (var scope = _app.Services.CreateScope())
        {
            // Pruning removes a run of the oldest entries, so make the first two old.
            var db = scope.ServiceProvider.GetRequiredService<MapleNotes.Server.Infrastructure.Persistence.MapleDbContext>();
            var oldest = await db.AuditEntries.OrderBy(e => e.Id).Take(2).Select(e => e.Id).ToListAsync(Ct);
            await db.AuditEntries.Where(e => oldest.Contains(e.Id))
                .ExecuteUpdateAsync(e => e.SetProperty(x => x.AtUtc, DateTime.UtcNow.AddDays(-AuditEntry.RetentionDays - 1)), Ct);
            Assert.Equal(2, await scope.ServiceProvider.GetRequiredService<AuditLog>().PruneAsync(Ct));
        }

        Assert.Single((await ListAsync())!.Items);
    }
}
