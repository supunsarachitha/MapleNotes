using System.Net;
using System.Net.Http.Json;
using System.Threading.RateLimiting;
using MapleNotes.Server.Features.Auth;
using MapleNotes.Server.Infrastructure.Web;
using MapleNotes.Server.Tests.TestSupport;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace MapleNotes.Server.Tests.Auth;

/// <summary>
/// The lockout answers the same way for unknown usernames, password confirmations count toward it, and the
/// unauthenticated endpoints share a global concurrency cap.
/// </summary>
public sealed class SignInHardeningTests
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task Real_and_unknown_usernames_answer_the_same_way_after_five_failures()
    {
        await using var app = new MapleAppFactory();
        using var client = new ApiClient(app);
        await client.SignUpAsync("maple");

        var real = new List<HttpResponseMessage>();
        var unknown = new List<HttpResponseMessage>();
        for (var i = 0; i <= AccountService.MaxFailedAttempts; i++)
        {
            real.Add(await client.LoginAsync("maple", "wrong password!!"));
            unknown.Add(await client.LoginAsync("nobody", "wrong password!!"));
        }

        Assert.Equal(real.Select(r => r.StatusCode), unknown.Select(r => r.StatusCode));
        Assert.Equal(HttpStatusCode.Unauthorized, real[0].StatusCode);
        Assert.Equal(HttpStatusCode.TooManyRequests, real[AccountService.MaxFailedAttempts - 1].StatusCode);
        Assert.Equal(HttpStatusCode.TooManyRequests, real[^1].StatusCode);
        for (var i = 0; i < real.Count; i++)
        {
            Assert.Equal(await TitleAsync(real[i]), await TitleAsync(unknown[i]));
            Assert.Equal(real[i].Headers.RetryAfter is null, unknown[i].Headers.RetryAfter is null);
        }

        Assert.True(unknown[^1].Headers.RetryAfter?.Delta > TimeSpan.FromMinutes(14));
    }

    [Fact]
    public async Task Unknown_username_lockout_lifts_after_the_lockout_duration()
    {
        var time = new ManualTimeProvider(new DateTimeOffset(2026, 11, 10, 12, 0, 0, TimeSpan.Zero));
        var lockout = new UnknownUsernameLockout(time);
        DateTime? lockedUntil = null;
        for (var i = 0; i < AccountService.MaxFailedAttempts; i++)
        {
            Assert.Null(lockout.LockedUntil("ghost"));
            lockedUntil = lockout.RecordFailure("ghost");
        }

        Assert.Equal(time.GetUtcNow().UtcDateTime + AccountService.LockoutDuration, lockedUntil);
        Assert.Equal(lockedUntil, lockout.LockedUntil("ghost"));
        time.Advance(AccountService.LockoutDuration + TimeSpan.FromSeconds(1));
        Assert.Null(lockout.LockedUntil("ghost"));
        Assert.Null(lockout.RecordFailure("ghost")); // the count started again, as it does for a real account
    }

    [Fact]
    public async Task Unknown_username_tracking_stays_bounded()
    {
        var lockout = new UnknownUsernameLockout(TimeProvider.System);
        for (var i = 0; i < UnknownUsernameLockout.Capacity + 500; i++)
        {
            lockout.RecordFailure($"name-{i}");
        }

        Assert.True(lockout.Count <= UnknownUsernameLockout.Capacity);
        await Task.CompletedTask;
    }

    [Fact]
    public async Task Wrong_password_confirmations_lock_the_account()
    {
        await using var app = new MapleAppFactory();
        using var client = new ApiClient(app);
        await client.SignUpAsync("maple");

        for (var i = 0; i < AccountService.MaxFailedAttempts - 1; i++)
        {
            Assert.Equal(HttpStatusCode.BadRequest, (await client.ChangePasswordAsync("a guessed password", "a brand new passphrase")).StatusCode);
        }

        var fifth = await client.ChangePasswordAsync("a guessed password", "a brand new passphrase");
        var rightButLocked = await client.ChangePasswordAsync(ApiClient.DefaultPassword, "a brand new passphrase");
        using var other = new ApiClient(app);
        var signIn = await other.LoginAsync("maple");

        Assert.Equal(HttpStatusCode.TooManyRequests, fifth.StatusCode);
        Assert.True(fifth.Headers.RetryAfter?.Delta > TimeSpan.FromMinutes(14));
        Assert.Equal(HttpStatusCode.TooManyRequests, rightButLocked.StatusCode);
        Assert.Equal(HttpStatusCode.TooManyRequests, signIn.StatusCode);
    }

    [Fact]
    public async Task Confirmations_and_sign_ins_share_one_counter()
    {
        await using var app = new MapleAppFactory();
        using var client = new ApiClient(app);
        await client.SignUpAsync("maple");
        using var attacker = new ApiClient(app);

        for (var i = 0; i < AccountService.MaxFailedAttempts - 1; i++)
        {
            await client.PostJsonAsync("/api/v1/account/two-factor", new EnableTwoFactorRequest(await client.ProofAsync("a guessed password"), "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP", "000000"));
        }

        var signIn = await attacker.LoginAsync("maple", "wrong password!!");

        Assert.Equal(HttpStatusCode.TooManyRequests, signIn.StatusCode);
    }

    [Fact]
    public async Task Authentication_endpoints_share_a_global_concurrency_cap()
    {
        using var limiter = RateLimitPolicies.CreateGlobalLimiter(permitLimit: 1, queueLimit: 0);
        var signIn = Request(RateLimitPolicies.Authentication);
        var prelogin = Request(RateLimitPolicies.Prelogin);
        var notes = Request(null);

        using var first = await limiter.AcquireAsync(signIn, cancellationToken: Ct);
        using var second = await limiter.AcquireAsync(prelogin, cancellationToken: Ct);
        using var unrelated = await limiter.AcquireAsync(notes, cancellationToken: Ct);

        Assert.True(first.IsAcquired);
        Assert.False(second.IsAcquired); // the one slot is taken, whichever authentication policy asks
        Assert.True(unrelated.IsAcquired); // other endpoints are not limited

        first.Dispose();
        using var third = await limiter.AcquireAsync(prelogin, cancellationToken: Ct);
        Assert.True(third.IsAcquired);
    }

    private static DefaultHttpContext Request(string? policy)
    {
        var context = new DefaultHttpContext();
        var metadata = policy is null ? new EndpointMetadataCollection() : new EndpointMetadataCollection(new EnableRateLimitingAttribute(policy));
        context.SetEndpoint(new Endpoint(_ => Task.CompletedTask, metadata, "test"));
        return context;
    }

    private static async Task<string?> TitleAsync(HttpResponseMessage response) =>
        (await response.Content.ReadFromJsonAsync<ProblemDetails>(ApiClient.Json, Ct))?.Title;
}
