using System.Net;
using System.Net.Http.Json;
using MapleNotes.Server.Domain;
using MapleNotes.Server.Features.Notes;
using MapleNotes.Server.Tests.TestSupport;

namespace MapleNotes.Server.Tests.Notes;

/// <summary>The calendar: active notes counted per day of the user's time zone, and the notes of one day.</summary>
public sealed class CalendarTests : IAsyncLifetime
{
    private readonly MapleAppFactory _app = new();
    private ApiClient _client = null!;

    public async ValueTask InitializeAsync()
    {
        _client = new ApiClient(_app);
        await _client.SignUpAsync("maple");
        // Paris switches to summer time on 2025-03-30: 22:30 UTC that evening is already 00:30 on the 31st.
        await ImportAsync("2025-03-30T12:00:00Z", "lunch");
        await ImportAsync("2025-03-30T22:30:00Z", "after midnight in Paris");
        await ImportAsync("2025-03-30T09:00:00Z", "# List\n\n- [ ] item", NoteKind.Todo);
        await ImportAsync("2025-03-30T10:00:00Z", "archived", archived: true);
        await ImportAsync("2025-03-15T08:00:00Z", "jotted", NoteKind.Quick);
        await ImportAsync("2025-04-01T08:00:00Z", "next month");
        await ImportAsync("2025-03-30T11:00:00Z", "# Walk\n\n- 2025-03-30", NoteKind.Habit); // counted only when asked for
    }

    public async ValueTask DisposeAsync()
    {
        _client.Dispose();
        await _app.DisposeAsync();
    }

    [Fact]
    public async Task Days_follow_the_requested_time_zone_and_count_active_notes()
    {
        var paris = await DaysAsync("from=2025-03-01&to=2025-03-31&timeZone=Europe/Paris");
        var utc = await DaysAsync("from=2025-03-01&to=2025-03-31");

        Assert.Equal([("2025-03-15", 1), ("2025-03-30", 2), ("2025-03-31", 1)], paris);
        Assert.Equal([("2025-03-15", 1), ("2025-03-30", 3)], utc);
    }

    [Fact]
    public async Task Only_the_requested_kinds_are_counted()
    {
        Assert.Equal([("2025-03-30", 1), ("2025-03-31", 1)], await DaysAsync("from=2025-03-01&to=2025-03-31&timeZone=Europe/Paris&kind=note"));
        Assert.Equal([("2025-03-30", 1)], await DaysAsync("from=2025-03-01&to=2025-03-31&kind=habit"));
    }

    [Fact]
    public async Task A_day_lists_the_notes_created_in_it()
    {
        // 2025-03-30 in Paris: from 23:00 UTC on the 29th to 22:00 UTC on the 30th.
        var page = await _client.GetJsonAsync<NotePageResponse>(
            "/api/v1/notes?state=active&kind=note&kind=todo&kind=quick&createdFrom=2025-03-29T23:00:00Z&createdBefore=2025-03-30T22:00:00Z");

        Assert.Equal(["lunch", "# List\n\n- [ ] item"], page!.Items.Select(n => n.Content));
    }

    [Theory]
    [InlineData("/api/v1/notes/calendar?from=2025-01-01&to=2025-03-31")]
    [InlineData("/api/v1/notes/calendar?from=2025-03-31&to=2025-03-01")]
    [InlineData("/api/v1/notes/calendar?from=2025-03-01&to=2025-03-31&timeZone=Mars/Olympus")]
    [InlineData("/api/v1/notes?createdFrom=2025-03-30T00:00:00Z&createdBefore=2025-03-30T00:00:00Z")]
    public async Task Invalid_ranges_and_time_zones_are_rejected(string url)
    {
        Assert.Equal(HttpStatusCode.BadRequest, (await _client.GetAsync(url)).StatusCode);
    }

    private async Task ImportAsync(string createdAtUtc, string content, NoteKind kind = NoteKind.Note, bool archived = false)
    {
        var created = DateTime.Parse(createdAtUtc, System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.AdjustToUniversal);
        (await _client.PostJsonAsync("/api/v1/notes/import", new ImportNoteRequest(created, created, Content: content, IsArchived: archived, Kind: kind)))
            .EnsureSuccessStatusCode();
    }

    private async Task<List<(string, int)>> DaysAsync(string query) =>
        (await _client.GetJsonAsync<List<CalendarDayResponse>>($"/api/v1/notes/calendar?{query}"))!
            .Select(d => (d.Date.ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture), d.Count)).ToList();
}
