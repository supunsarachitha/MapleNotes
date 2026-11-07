using System.Buffers.Binary;
using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using MapleNotes.Server.Domain;
using MapleNotes.Server.Features.Notes;
using MapleNotes.Server.Features.Push;
using MapleNotes.Server.Features.Reminders;
using MapleNotes.Server.Infrastructure.Configuration;
using MapleNotes.Server.Tests.TestSupport;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace MapleNotes.Server.Tests.Push;

/// <summary>A push service that records what it is sent and answers with a chosen status.</summary>
internal sealed class FakePushService : HttpMessageHandler
{
    public List<(Uri Url, Dictionary<string, string> Headers, byte[] Body)> Received { get; } = [];

    public HttpStatusCode Status { get; set; } = HttpStatusCode.Created;

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var headers = request.Headers.Concat(request.Content!.Headers).ToDictionary(h => h.Key, h => string.Join(",", h.Value));
        Received.Add((request.RequestUri!, headers, await request.Content.ReadAsByteArrayAsync(cancellationToken)));
        return new HttpResponseMessage(Status);
    }
}

/// <summary>A browser's side of a push subscription: its keys, and decryption (RFC 8291) to read what arrives.</summary>
internal sealed class FakeDevice : IDisposable
{
    private readonly ECDiffieHellman _key = ECDiffieHellman.Create(ECCurve.NamedCurves.nistP256);

    public byte[] Auth { get; } = RandomNumberGenerator.GetBytes(16);

    public byte[] PublicKey
    {
        get
        {
            var q = _key.ExportParameters(false).Q;
            return [0x04, .. q.X!, .. q.Y!];
        }
    }

    public PushSubscriptionRequest Subscription(string endpoint = "https://push.example.net/send/abc", string name = "Firefox on Linux") =>
        new(endpoint, WebEncoders.Base64UrlEncode(PublicKey), WebEncoders.Base64UrlEncode(Auth), name);

    public JsonElement Decrypt(byte[] body)
    {
        var salt = body[..16];
        Assert.Equal(4096u, BinaryPrimitives.ReadUInt32BigEndian(body.AsSpan(16)));
        var senderPublic = body[21..(21 + body[20])];
        using var sender = ECDiffieHellman.Create(new ECParameters
        {
            Curve = ECCurve.NamedCurves.nistP256, Q = new ECPoint { X = senderPublic[1..33], Y = senderPublic[33..] },
        });
        var secret = _key.DeriveRawSecretAgreement(sender.PublicKey);
        var ikm = HKDF.DeriveKey(HashAlgorithmName.SHA256, secret, 32, Auth, [.. "WebPush: info\0"u8, .. PublicKey, .. senderPublic]);
        var prk = HKDF.Extract(HashAlgorithmName.SHA256, ikm, salt);
        var cek = HKDF.Expand(HashAlgorithmName.SHA256, prk, 16, "Content-Encoding: aes128gcm\0"u8.ToArray());
        var nonce = HKDF.Expand(HashAlgorithmName.SHA256, prk, 12, "Content-Encoding: nonce\0"u8.ToArray());
        var record = body[(21 + body[20])..];
        var plain = new byte[record.Length - 16];
        using (var aes = new AesGcm(cek, 16))
        {
            aes.Decrypt(nonce, record[..^16], record[^16..], plain);
        }

        Assert.Equal(0x02, plain[^1]);
        return JsonDocument.Parse(plain[..^1]).RootElement.Clone();
    }

    public void Dispose() => _key.Dispose();
}

public sealed class RemindersTests : IAsyncLifetime
{
    private readonly ManualTimeProvider _clock = new(new DateTimeOffset(2026, 11, 7, 12, 0, 0, TimeSpan.Zero));
    private readonly FakePushService _pushService = new();
    private readonly MapleAppFactory _app = new() { Settings = { [MapleOptions.AllowRegistrationKey] = "true" } };
    private ApiClient _client = null!;

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    public async ValueTask InitializeAsync()
    {
        _app.ConfigureTestServices = services =>
        {
            services.AddSingleton<TimeProvider>(_clock);
            services.AddHttpClient(PushService.ClientName).ConfigurePrimaryHttpMessageHandler(() => _pushService);
            services.Remove(services.Single(s => s.ImplementationType == typeof(ReminderSenderService))); // tests send by hand
        };
        _client = new ApiClient(_app);
        await _client.SignUpAsync("maple");
    }

    public async ValueTask DisposeAsync()
    {
        _client.Dispose();
        await _app.DisposeAsync();
    }

    private async Task<NoteResponse> NoteAsync(string text, NoteKind kind = NoteKind.Note) =>
        (await (await _client.PostJsonAsync("/api/v1/notes", new CreateNoteRequest(text, Kind: kind))).Content
            .ReadFromJsonAsync<NoteResponse>(ApiClient.Json, Ct))!;

    private Task<HttpResponseMessage> RemindAsync(Guid noteId, string at, ReminderRepeat repeat = ReminderRepeat.None, string zone = "America/Toronto") =>
        _client.PutJsonAsync($"/api/v1/notes/{noteId}/reminder", new SetReminderRequest(at, zone, repeat));

    private async Task<int> SendDueAsync()
    {
        using var scope = _app.Services.CreateScope();
        return await scope.ServiceProvider.GetRequiredService<ReminderService>().SendDueAsync(Ct);
    }

    private async Task<string> ProblemFieldAsync(HttpResponseMessage response)
    {
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        return Assert.Single((await response.Content.ReadFromJsonAsync<ValidationProblemDetails>(Ct))!.Errors.Keys);
    }

    [Fact]
    public async Task A_reminder_reaches_every_device_encrypted_for_it_with_vapid_and_a_one_off_one_then_goes()
    {
        using var phone = new FakeDevice();
        using var laptop = new FakeDevice();
        (await _client.PostJsonAsync("/api/v1/account/push-subscriptions", phone.Subscription("https://fcm.googleapis.com/fcm/send/p1", "Chrome on Android"))).EnsureSuccessStatusCode();
        (await _client.PostJsonAsync("/api/v1/account/push-subscriptions", laptop.Subscription())).EnsureSuccessStatusCode();
        var note = await NoteAsync("# Buy **maple syrup**\n\nThe dark one.");

        // 12:00 UTC is 07:00 in Toronto; remind at 07:30 local.
        var set = (await (await RemindAsync(note.Id, "2026-11-07T07:30")).Content.ReadFromJsonAsync<ReminderResponse>(ApiClient.Json, Ct))!;
        Assert.Equal(new DateTime(2026, 11, 7, 12, 30, 0, DateTimeKind.Utc), set.NextAtUtc);
        Assert.Equal(0, await SendDueAsync()); // not yet

        _clock.Advance(TimeSpan.FromMinutes(31));
        Assert.Equal(2, await SendDueAsync());

        Assert.Equal(2, _pushService.Received.Count);
        var toPhone = _pushService.Received.Single(r => r.Url.Host == "fcm.googleapis.com");
        Assert.Equal("aes128gcm", toPhone.Headers["Content-Encoding"]);
        Assert.StartsWith("vapid t=", toPhone.Headers["Authorization"]);
        var message = phone.Decrypt(toPhone.Body);
        Assert.Equal("Reminder", message.GetProperty("title").GetString());
        Assert.Equal("Buy maple syrup", message.GetProperty("body").GetString());
        Assert.Equal(note.Id, message.GetProperty("noteId").GetGuid());
        laptop.Decrypt(_pushService.Received.Single(r => r.Url.Host == "push.example.net").Body);

        Assert.Empty((await _client.GetJsonAsync<List<ReminderResponse>>("/api/v1/reminders"))!); // a one-off reminder is done
        Assert.Equal(0, await SendDueAsync());
    }

    [Fact]
    public async Task Repeating_reminders_keep_their_local_time_across_daylight_saving_and_month_ends()
    {
        var zone = TimeZoneInfo.FindSystemTimeZoneById("America/Toronto");
        // Daily at 09:00 from 31 Oct: 13:00 UTC in daylight time, 14:00 UTC after clocks go back on 1 Nov.
        Assert.Equal(new DateTime(2026, 11, 2, 14, 0, 0), ReminderSchedule.Next(new DateTime(2026, 10, 31, 9, 0, 0), zone, ReminderRepeat.Daily, new DateTime(2026, 11, 1, 15, 0, 0)));
        Assert.Equal(new DateTime(2026, 10, 31, 13, 0, 0), ReminderSchedule.Next(new DateTime(2026, 10, 31, 9, 0, 0), zone, ReminderRepeat.Daily, new DateTime(2026, 10, 31, 12, 0, 0)));
        // Monthly on the 31st: 30 Nov, then 31 Dec (not stuck on the 30th).
        var monthly = new DateTime(2026, 10, 31, 9, 0, 0);
        Assert.Equal(new DateTime(2026, 11, 30, 14, 0, 0), ReminderSchedule.Next(monthly, zone, ReminderRepeat.Monthly, new DateTime(2026, 11, 1)));
        Assert.Equal(new DateTime(2026, 12, 31, 14, 0, 0), ReminderSchedule.Next(monthly, zone, ReminderRepeat.Monthly, new DateTime(2026, 12, 1)));
        // Weekly, from far back, lands on the right weekday.
        Assert.Equal(new DateTime(2026, 11, 9, 14, 0, 0), ReminderSchedule.Next(new DateTime(2020, 1, 6, 9, 0, 0), zone, ReminderRepeat.Weekly, new DateTime(2026, 11, 7)));
        // 02:30 on the spring-forward night does not exist: it goes off at 03:30.
        Assert.Equal(new DateTime(2027, 3, 14, 7, 30, 0), ReminderSchedule.ToUtc(new DateTime(2027, 3, 14, 2, 30, 0), zone));
        Assert.Null(ReminderSchedule.Next(new DateTime(2026, 11, 1, 9, 0, 0), zone, ReminderRepeat.None, new DateTime(2026, 11, 7)));

        // Through the API: a daily reminder sends and moves to tomorrow.
        using var phone = new FakeDevice();
        (await _client.PostJsonAsync("/api/v1/account/push-subscriptions", phone.Subscription())).EnsureSuccessStatusCode();
        var note = await NoteAsync("Stretch", NoteKind.Quick);
        (await RemindAsync(note.Id, "2026-11-07T07:05", ReminderRepeat.Daily)).EnsureSuccessStatusCode();
        _clock.Advance(TimeSpan.FromMinutes(6));
        Assert.Equal(1, await SendDueAsync());
        var after = Assert.Single((await _client.GetJsonAsync<List<ReminderResponse>>("/api/v1/reminders"))!);
        Assert.Equal((new DateTime(2026, 11, 8, 12, 5, 0), ReminderRepeat.Daily, "2026-11-07T07:05"), (after.NextAtUtc, after.Repeat, after.At));
    }

    [Fact]
    public async Task Reminders_are_checked_and_skip_archived_trashed_and_long_overdue_notes()
    {
        var note = await NoteAsync("Call the dentist");
        var todo = await NoteAsync("# Groceries\n\n- [ ] Milk", NoteKind.Todo);
        Assert.Equal("at", await ProblemFieldAsync(await RemindAsync(note.Id, "tomorrow")));
        Assert.Equal("at", await ProblemFieldAsync(await RemindAsync(note.Id, "2026-11-07T06:00"))); // passed
        Assert.Equal("timeZone", await ProblemFieldAsync(await RemindAsync(note.Id, "2026-11-08T09:00", zone: "Pacific Standard Time")));
        Assert.Equal("noteId", await ProblemFieldAsync(await RemindAsync(todo.Id, "2026-11-08T09:00")));
        Assert.Equal(HttpStatusCode.NotFound, (await RemindAsync(Guid.NewGuid(), "2026-11-08T09:00")).StatusCode);
        using (var other = new ApiClient(_app))
        {
            await other.SignUpAsync("other");
            Assert.Equal(HttpStatusCode.NotFound, (await other.PutJsonAsync($"/api/v1/notes/{note.Id}/reminder", new SetReminderRequest("2026-11-08T09:00", "UTC"))).StatusCode);
        }

        using var phone = new FakeDevice();
        (await _client.PostJsonAsync("/api/v1/account/push-subscriptions", phone.Subscription())).EnsureSuccessStatusCode();
        var archived = await NoteAsync("Archived");
        var overdue = await NoteAsync("Overdue");
        foreach (var id in new[] { note.Id, archived.Id, overdue.Id })
        {
            (await RemindAsync(id, "2026-11-07T07:10", ReminderRepeat.None)).EnsureSuccessStatusCode();
        }

        (await _client.PatchJsonAsync($"/api/v1/notes/{archived.Id}", new PatchNoteRequest(IsArchived: true))).EnsureSuccessStatusCode();
        (await _client.PatchJsonAsync($"/api/v1/notes/{note.Id}", new PatchNoteRequest(IsTrashed: true))).EnsureSuccessStatusCode();
        Assert.Equal([overdue.Id], (await _client.GetJsonAsync<List<ReminderResponse>>("/api/v1/reminders"))!.Select(r => r.NoteId));

        _clock.Advance(TimeSpan.FromHours(13)); // more than 12 hours late (the server was off)
        Assert.Equal(0, await SendDueAsync());
        Assert.Empty(_pushService.Received);

        // Deleting a note for good removes its reminder.
        var gone = await NoteAsync("Gone");
        (await RemindAsync(gone.Id, "2026-11-09T09:00")).EnsureSuccessStatusCode();
        (await _client.PatchJsonAsync($"/api/v1/notes/{gone.Id}", new PatchNoteRequest(IsTrashed: true))).EnsureSuccessStatusCode();
        (await _client.DeleteAsync($"/api/v1/notes/{gone.Id}")).EnsureSuccessStatusCode();
        using var scope = _app.Services.CreateScope();
        Assert.False(scope.ServiceProvider.GetRequiredService<MapleNotes.Server.Infrastructure.Persistence.MapleDbContext>().NoteReminders.Any(r => r.NoteId == gone.Id));
    }

    [Fact]
    public async Task Devices_are_checked_listed_tested_and_removed_when_their_push_service_says_they_are_gone()
    {
        using var phone = new FakeDevice();
        Assert.Equal("endpoint", await ProblemFieldAsync(await _client.PostJsonAsync("/api/v1/account/push-subscriptions", phone.Subscription("http://push.example.net/x"))));
        Assert.Equal("endpoint", await ProblemFieldAsync(await _client.PostJsonAsync("/api/v1/account/push-subscriptions", phone.Subscription("https://10.0.0.5/x"))));
        Assert.Equal("endpoint", await ProblemFieldAsync(await _client.PostJsonAsync("/api/v1/account/push-subscriptions", phone.Subscription("https://localhost/x"))));
        var badKey = phone.Subscription() with { P256dh = WebEncoders.Base64UrlEncode(new byte[65]) };
        Assert.Equal("p256dh", await ProblemFieldAsync(await _client.PostJsonAsync("/api/v1/account/push-subscriptions", badKey)));

        var key = (await _client.GetJsonAsync<PushKeyResponse>("/api/v1/push/key"))!.PublicKey;
        Assert.Equal(key, (await _client.GetJsonAsync<PushKeyResponse>("/api/v1/push/key"))!.PublicKey); // made once, kept
        Assert.Equal(65, WebEncoders.Base64UrlDecode(key).Length);

        var device = (await (await _client.PostJsonAsync("/api/v1/account/push-subscriptions", phone.Subscription())).Content
            .ReadFromJsonAsync<PushSubscriptionResponse>(ApiClient.Json, Ct))!;
        (await _client.PostJsonAsync("/api/v1/account/push-subscriptions", phone.Subscription(name: "Renamed"))).EnsureSuccessStatusCode(); // same endpoint: updated
        var listed = Assert.Single((await _client.GetJsonAsync<List<PushSubscriptionResponse>>("/api/v1/account/push-subscriptions"))!);
        Assert.Equal((device.Id, "Renamed"), (listed.Id, listed.Name));

        Assert.Equal(HttpStatusCode.NoContent, (await _client.PostAsync($"/api/v1/account/push-subscriptions/{device.Id}/test")).StatusCode);
        Assert.Equal("Notifications are on", phone.Decrypt(_pushService.Received[^1].Body).GetProperty("title").GetString());

        _pushService.Status = HttpStatusCode.Gone;
        Assert.Equal(HttpStatusCode.Gone, (await _client.PostAsync($"/api/v1/account/push-subscriptions/{device.Id}/test")).StatusCode);
        Assert.Empty((await _client.GetJsonAsync<List<PushSubscriptionResponse>>("/api/v1/account/push-subscriptions"))!);

        (await _client.PostJsonAsync("/api/v1/account/push-subscriptions", phone.Subscription())).EnsureSuccessStatusCode();
        var again = Assert.Single((await _client.GetJsonAsync<List<PushSubscriptionResponse>>("/api/v1/account/push-subscriptions"))!);
        Assert.Equal(HttpStatusCode.NoContent, (await _client.DeleteAsync($"/api/v1/account/push-subscriptions/{again.Id}")).StatusCode);
        Assert.Empty((await _client.GetJsonAsync<List<PushSubscriptionResponse>>("/api/v1/account/push-subscriptions"))!);
    }

    [Fact]
    public void Notification_text_is_the_notes_first_line_without_markdown()
    {
        Assert.Equal("Buy maple syrup", ReminderService.FirstLine("\n\n# Buy **maple syrup**\nmore"));
        Assert.Equal("Book the canoe", ReminderService.FirstLine("- [ ] Book the canoe"));
        Assert.Equal("A note", ReminderService.FirstLine("  \n"));
        Assert.Equal(140, ReminderService.FirstLine(new string('a', 300)).Length);
    }
}
