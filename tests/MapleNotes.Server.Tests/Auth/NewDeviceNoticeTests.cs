using System.Net;
using System.Text.Json;
using MapleNotes.Server.Domain;
using MapleNotes.Server.Features.Auth;
using MapleNotes.Server.Features.Push;
using MapleNotes.Server.Infrastructure.Configuration;
using MapleNotes.Server.Infrastructure.Persistence;
using MapleNotes.Server.Tests.Push;
using MapleNotes.Server.Tests.TestSupport;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace MapleNotes.Server.Tests.Auth;

/// <summary>Sign-ins from a new device: detection, the push notification, the banner notices and the device list mark.</summary>
public sealed class NewDeviceNoticeTests : IAsyncLifetime
{
    private const string Firefox = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0";
    private const string Safari = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";

    private readonly FakePushService _pushService = new();
    private readonly MapleAppFactory _app = new() { Settings = { [MapleOptions.AllowRegistrationKey] = "true" } };
    private readonly FakeDevice _phone = new();
    private ApiClient _laptop = null!;

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    public async ValueTask InitializeAsync()
    {
        _app.ConfigureTestServices = services =>
            services.AddHttpClient(PushService.ClientName).ConfigurePrimaryHttpMessageHandler(() => _pushService);
        _laptop = Client(Firefox);
        await _laptop.SignUpAsync("maple");
        (await _laptop.PostJsonAsync("/api/v1/account/push-subscriptions", _phone.Subscription())).EnsureSuccessStatusCode();
        _pushService.Received.Clear(); // the "notifications are on" test message
    }

    public async ValueTask DisposeAsync()
    {
        _laptop.Dispose();
        _phone.Dispose();
        await _app.DisposeAsync();
    }

    private ApiClient Client(string userAgent)
    {
        var client = new ApiClient(_app);
        client.Http.DefaultRequestHeaders.UserAgent.ParseAdd(userAgent);
        return client;
    }

    private async Task<List<SignInNoticeResponse>> NoticesAsync(ApiClient client) =>
        (await client.GetJsonAsync<List<SignInNoticeResponse>>("/api/v1/auth/sign-in-notices"))!;

    [Fact]
    public async Task The_first_sign_in_of_an_account_and_a_known_device_raise_no_notice()
    {
        using var again = Client(Firefox);
        (await again.LoginAsync("maple")).EnsureSuccessStatusCode();

        Assert.Empty(_pushService.Received);
        Assert.Empty(await NoticesAsync(_laptop));
        Assert.All((await _laptop.GetJsonAsync<List<SessionResponse>>("/api/v1/auth/sessions"))!, s => Assert.False(s.NewDevice));
    }

    [Fact]
    public async Task A_sign_in_from_a_new_device_pushes_a_notice_without_note_content_and_marks_the_session()
    {
        using var iphone = Client(Safari);
        (await iphone.LoginAsync("maple")).EnsureSuccessStatusCode();

        var message = _phone.Decrypt(Assert.Single(_pushService.Received).Body);
        Assert.Equal("New sign-in", message.GetProperty("title").GetString());
        Assert.Equal(
            "Safari on iOS signed in to your account. Not you? Open Settings and sign out everywhere.",
            message.GetProperty("body").GetString());
        Assert.Equal(SignInDevices.PushTag, message.GetProperty("tag").GetString());
        Assert.Equal(JsonValueKind.Null, message.GetProperty("noteId").ValueKind);

        var notice = Assert.Single(await NoticesAsync(_laptop));
        Assert.Equal("Safari on iOS", notice.Device);
        Assert.Empty(await NoticesAsync(iphone)); // not warned about itself

        var list = (await _laptop.GetJsonAsync<List<SessionResponse>>("/api/v1/auth/sessions"))!;
        Assert.True(Assert.Single(list, s => s.Device == "Safari on iOS").NewDevice);
        Assert.False(Assert.Single(list, s => s.Current).NewDevice);

        // The second sign-in from it is a known device.
        _pushService.Received.Clear();
        using var iphoneAgain = Client(Safari);
        (await iphoneAgain.LoginAsync("maple")).EnsureSuccessStatusCode();
        Assert.Empty(_pushService.Received);
        Assert.Single(await NoticesAsync(_laptop));
    }

    [Fact]
    public async Task A_dismissed_notice_is_gone_on_every_device_and_only_its_owner_can_dismiss_it()
    {
        using var iphone = Client(Safari);
        (await iphone.LoginAsync("maple")).EnsureSuccessStatusCode();
        var notice = Assert.Single(await NoticesAsync(_laptop));

        using var other = Client(Firefox);
        await other.SignUpAsync("birch");
        Assert.Equal(HttpStatusCode.NotFound, (await other.PostAsync($"/api/v1/auth/sign-in-notices/{notice.Id}/dismiss")).StatusCode);

        Assert.Equal(HttpStatusCode.NoContent, (await _laptop.PostAsync($"/api/v1/auth/sign-in-notices/{notice.Id}/dismiss")).StatusCode);
        Assert.Empty(await NoticesAsync(_laptop));
        Assert.Equal(HttpStatusCode.NotFound, (await _laptop.PostAsync($"/api/v1/auth/sign-in-notices/{notice.Id}/dismiss")).StatusCode);
    }

    [Fact]
    public async Task Signing_out_everywhere_clears_the_notices()
    {
        using var iphone = Client(Safari);
        (await iphone.LoginAsync("maple")).EnsureSuccessStatusCode();
        (await _laptop.PostAsync("/api/v1/auth/sign-out-everywhere")).EnsureSuccessStatusCode();

        (await _laptop.LoginAsync("maple")).EnsureSuccessStatusCode();
        Assert.Empty(await NoticesAsync(_laptop));
    }

    [Fact]
    public async Task A_device_not_signed_in_from_for_90_days_is_new_again()
    {
        using var iphone = Client(Safari);
        (await iphone.LoginAsync("maple")).EnsureSuccessStatusCode();
        (await _laptop.PostAsync($"/api/v1/auth/sign-in-notices/{Assert.Single(await NoticesAsync(_laptop)).Id}/dismiss")).EnsureSuccessStatusCode();
        (await iphone.PostAsync("/api/v1/auth/logout")).EnsureSuccessStatusCode();
        using (var scope = _app.Services.CreateScope())
        {
            await scope.ServiceProvider.GetRequiredService<MapleDbContext>().KnownDevices.Where(d => d.Device == "Safari on iOS")
                .ExecuteUpdateAsync(d => d.SetProperty(x => x.LastSeenAtUtc, DateTime.UtcNow.AddDays(-KnownDevice.RememberDays - 1)), Ct);
        }

        _pushService.Received.Clear();
        (await iphone.LoginAsync("maple")).EnsureSuccessStatusCode();

        Assert.Single(_pushService.Received);
        Assert.Single(await NoticesAsync(_laptop));
    }

    [Theory]
    [InlineData("203.0.113.57", "203.0.113.0/24")]
    [InlineData("::ffff:203.0.113.57", "203.0.113.0/24")]
    [InlineData("2001:db8:abcd:12:1:2:3:4", "2001:db8:abcd::/48")]
    [InlineData(null, "")]
    public void Only_the_network_of_an_address_is_compared(string? address, string network) =>
        Assert.Equal(network, SignInDevices.NetworkOf(address is null ? null : IPAddress.Parse(address)));
}
