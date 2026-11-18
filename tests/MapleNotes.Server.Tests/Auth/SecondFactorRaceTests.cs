using System.Net;
using System.Net.Http.Json;
using MapleNotes.Server.Features.Auth;
using MapleNotes.Server.Infrastructure.Configuration;
using MapleNotes.Server.Infrastructure.Persistence;
using MapleNotes.Server.Tests.TestSupport;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace MapleNotes.Server.Tests.Auth;

/// <summary>
/// An authenticator code or a recovery code is accepted once, even when several requests send it at the same moment:
/// spending it is one conditional write in the database, and the requests that lose the race are refused as if the
/// code were wrong.
/// </summary>
public sealed class SecondFactorRaceTests : IAsyncLifetime
{
    // At most this many sign-in requests run at once (RateLimitPolicies.GlobalConcurrencyLimit is at least 4), and
    // fewer than AccountService.MaxFailedAttempts losers, so the losers do not lock the account.
    private const int Parallel = 4;

    private readonly ManualTimeProvider _clock = new(DateTimeOffset.UtcNow);
    private readonly UserUpdateGate _gate = new();
    private readonly MapleAppFactory _app = new() { Settings = { [MapleOptions.AllowRegistrationKey] = "true" } };
    private readonly ApiClient _client;

    public SecondFactorRaceTests()
    {
        _app.ConfigureTestServices = services =>
        {
            services.AddSingleton<TimeProvider>(_clock);
            services.ConfigureDbContext<MapleDbContext>(options => options.AddInterceptors(_gate));
        };
        _client = new ApiClient(_app);
    }

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    public async ValueTask InitializeAsync() => await _client.SignUpAsync("maple");

    public async ValueTask DisposeAsync()
    {
        _client.Dispose();
        await _app.DisposeAsync();
    }

    [Fact]
    public async Task One_authenticator_code_sent_by_parallel_sign_ins_signs_in_once()
    {
        var (secret, _) = await EnableAsync();
        _clock.Advance(TimeSpan.FromSeconds(Totp.StepSeconds));
        var code = CurrentCode(secret);

        var statuses = await SignInTogetherAsync(code);

        Assert.True(_gate.OpenedByArrivals, "the requests did not all reach the database together");
        Assert.Equal(1, statuses.Count(s => s == HttpStatusCode.OK));
        Assert.Equal(Parallel - 1, statuses.Count(s => s == HttpStatusCode.Unauthorized));
    }

    [Fact]
    public async Task One_recovery_code_sent_by_parallel_sign_ins_signs_in_once_and_is_used_up_once()
    {
        var (_, codes) = await EnableAsync();

        var statuses = await SignInTogetherAsync(codes[2]);

        Assert.True(_gate.OpenedByArrivals, "the requests did not all reach the database together");
        Assert.Equal(1, statuses.Count(s => s == HttpStatusCode.OK));
        Assert.Equal(Parallel - 1, statuses.Count(s => s == HttpStatusCode.Unauthorized));
        Assert.Equal(TwoFactorService.RecoveryCodeCount - 1,
            (await _client.GetJsonAsync<TwoFactorStatusResponse>("/api/v1/account/two-factor"))!.RecoveryCodesLeft);

        // The other codes still work: the losers' writes did not bring the used one back or drop another one.
        using var later = new ApiClient(_app);
        Assert.Equal(HttpStatusCode.Unauthorized, (await later.LoginAsync("maple", twoFactorCode: codes[2])).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await later.LoginAsync("maple", twoFactorCode: codes[5])).StatusCode);
        Assert.Equal(TwoFactorService.RecoveryCodeCount - 2,
            (await _client.GetJsonAsync<TwoFactorStatusResponse>("/api/v1/account/two-factor"))!.RecoveryCodesLeft);
    }

    [Fact]
    public async Task One_code_sent_by_parallel_step_up_confirmations_confirms_once()
    {
        var (secret, _) = await EnableAsync();
        var sessions = new List<ApiClient>();
        try
        {
            for (var i = 0; i < Parallel; i++)
            {
                _clock.Advance(TimeSpan.FromSeconds(Totp.StepSeconds));
                var session = new ApiClient(_app);
                sessions.Add(session);
                Assert.Equal(HttpStatusCode.OK, (await session.LoginAsync("maple", twoFactorCode: CurrentCode(secret))).StatusCode);
            }

            _clock.Advance(TimeSpan.FromSeconds(Totp.StepSeconds));
            var code = CurrentCode(secret);
            _gate.Arm(Parallel);
            var start = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            var requests = sessions.Select(async session =>
            {
                await start.Task;
                return (await session.PostJsonAsync("/api/v1/auth/confirm", new ConfirmRequest(Code: code))).StatusCode;
            }).ToList();
            start.SetResult();
            var statuses = await Task.WhenAll(requests);

            Assert.True(_gate.OpenedByArrivals, "the requests did not all reach the database together");
            Assert.Equal(1, statuses.Count(s => s == HttpStatusCode.OK));
            Assert.Equal(Parallel - 1, statuses.Count(s => s == HttpStatusCode.BadRequest));
        }
        finally
        {
            sessions.ForEach(s => s.Dispose());
        }
    }

    [Fact]
    public async Task A_code_used_after_a_parallel_race_still_cannot_be_used_again_and_the_account_keeps_its_state()
    {
        var (secret, _) = await EnableAsync();
        _clock.Advance(TimeSpan.FromSeconds(Totp.StepSeconds));
        var code = CurrentCode(secret);
        await SignInTogetherAsync(code);

        // Two-factor sign-in is still on with the stored step: the same code is refused, the next one works.
        using var replay = new ApiClient(_app);
        Assert.Equal(HttpStatusCode.Unauthorized, (await replay.LoginAsync("maple", twoFactorCode: code)).StatusCode);
        _clock.Advance(TimeSpan.FromSeconds(Totp.StepSeconds));
        Assert.Equal(HttpStatusCode.OK, (await replay.LoginAsync("maple", twoFactorCode: CurrentCode(secret))).StatusCode);

        using var scope = _app.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<MapleDbContext>();
        var user = await db.Users.AsNoTracking().SingleAsync(u => u.Username == "maple", Ct);
        Assert.Equal(Totp.StepAt(_clock.GetUtcNow()), user.TwoFactorLastStep);
        Assert.Equal(0, user.AccessFailedCount); // the full sign-in reset the count the losers added
    }

    private async Task<HttpStatusCode[]> SignInTogetherAsync(string code)
    {
        var devices = Enumerable.Range(0, Parallel).Select(_ => new ApiClient(_app)).ToList();
        try
        {
            _gate.Arm(Parallel);
            var start = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            var requests = devices.Select(async device =>
            {
                await start.Task;
                return (await device.LoginAsync("maple", twoFactorCode: code)).StatusCode;
            }).ToList();
            start.SetResult();
            return await Task.WhenAll(requests);
        }
        finally
        {
            devices.ForEach(d => d.Dispose());
        }
    }

    private async Task<(string Secret, IReadOnlyList<string> Codes)> EnableAsync()
    {
        var setup = (await (await _client.PostAsync("/api/v1/account/two-factor/setup")).Content
            .ReadFromJsonAsync<TwoFactorSetupResponse>(ApiClient.Json, Ct))!;
        var response = await _client.PostJsonAsync("/api/v1/account/two-factor",
            new EnableTwoFactorRequest(await _client.ProofAsync(), setup.Secret, CurrentCode(setup.Secret)));
        Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync(Ct));
        var codes = (await response.Content.ReadFromJsonAsync<RecoveryCodesResponse>(ApiClient.Json, Ct))!;
        await _client.RefreshAntiforgeryTokenAsync(); // turning it on renews the session
        return (setup.Secret, codes.Codes);
    }

    private string CurrentCode(string secret) => Totp.Code(Totp.FromBase32(secret)!, Totp.StepAt(_clock.GetUtcNow()));
}
