using System.Net;
using System.Net.Http.Json;
using MapleNotes.Server.Domain;
using MapleNotes.Server.Features.Auth;
using MapleNotes.Server.Infrastructure.Configuration;
using MapleNotes.Server.Tests.TestSupport;
using Microsoft.AspNetCore.Mvc;

namespace MapleNotes.Server.Tests.Preferences;

/// <summary>Per-account preferences: defaults, saving, validation, and isolation between accounts.</summary>
public sealed class PreferencesTests : IAsyncLifetime
{
    private readonly MapleAppFactory _app = new() { Settings = { [MapleOptions.AllowRegistrationKey] = "true" } };
    private ApiClient _alice = null!;
    private ApiClient _bob = null!;

    public async ValueTask InitializeAsync()
    {
        _alice = new ApiClient(_app);
        _bob = new ApiClient(_app);
        await _alice.SignUpAsync("alice");
        await _bob.SignUpAsync("bob");
    }

    public async ValueTask DisposeAsync()
    {
        _alice.Dispose();
        _bob.Dispose();
        await _app.DisposeAsync();
    }

    [Fact]
    public async Task A_new_account_has_the_default_preferences()
    {
        var preferences = await _alice.GetJsonAsync<UserPreferences>("/api/v1/account/preferences");

        Assert.Equal(new UserPreferences(), preferences);
        Assert.Equal((false, false, "yyyy-MM-dd", true, true, false),
            (preferences!.NoteTitles, preferences.DateInTitles, preferences.DateFormat, preferences.TodoLists, preferences.QuickNotes, preferences.DailyNotes));
        Assert.False(preferences.HabitTracker); // habits are opt-in
        Assert.False(preferences.ShrinkPhotos); // so is shrinking photos, which replaces the original
        Assert.Equal((true, true, "Medium", "Auto"), (preferences.Archive, preferences.Tags, preferences.MenuTextSize, preferences.WeekStart));
        Assert.Equal((false, false), (preferences.QuickNoteTitles, preferences.DoubleTapToEdit)); // both opt-in
        Assert.Equal((false, false, true, ""), (preferences.TagSuggestions, preferences.Labels, preferences.Trash, preferences.MenuOrder));
        Assert.True(preferences.HelpMenu);
        Assert.Equal("Large", preferences.PhotoSize); // as photos were shrunk before sizes could be chosen
        Assert.Equal(preferences, (await _alice.GetJsonAsync<UserResponse>("/api/v1/auth/me"))!.Preferences);
    }

    [Fact]
    public async Task Saved_preferences_come_back_with_the_user_and_are_per_account()
    {
        var wanted = new UserPreferences
        {
            NoteTitles = true, DateInTitles = true, DateFormat = "dddd, d MMMM yyyy", TodoLists = false, QuickNotes = false, DailyNotes = true,
            HabitTracker = true, ShrinkPhotos = true, Archive = false, Tags = false, MenuTextSize = "Large", WeekStart = "Monday",
            QuickNoteTitles = true, DoubleTapToEdit = true, TagSuggestions = true, Labels = true, Trash = false, MenuOrder = "help,home,todo",
            HelpMenu = false, PhotoSize = "Small",
        };

        var response = await _alice.PutJsonAsync("/api/v1/account/preferences", wanted);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(wanted, await response.Content.ReadFromJsonAsync<UserPreferences>(ApiClient.Json, TestContext.Current.CancellationToken));
        Assert.Equal(wanted, await _alice.GetJsonAsync<UserPreferences>("/api/v1/account/preferences"));
        Assert.Equal(wanted, (await _alice.GetJsonAsync<AuthStatusResponse>("/api/v1/auth/status"))!.User!.Preferences);
        Assert.Equal(new UserPreferences(), await _bob.GetJsonAsync<UserPreferences>("/api/v1/account/preferences"));
    }

    [Fact]
    public async Task Fields_left_out_take_their_default_values()
    {
        var response = await _alice.PutJsonAsync("/api/v1/account/preferences", new { noteTitles = true });

        Assert.Equal(new UserPreferences { NoteTitles = true }, await response.Content.ReadFromJsonAsync<UserPreferences>(ApiClient.Json, TestContext.Current.CancellationToken));
    }

    [Theory]
    [InlineData("")]
    [InlineData("yyyy")]
    [InlineData("<script>")]
    public async Task Only_the_offered_date_formats_are_accepted(string format)
    {
        var response = await _alice.PutJsonAsync("/api/v1/account/preferences", new UserPreferences { DateFormat = format });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("dateFormat", (await response.Content.ReadFromJsonAsync<ValidationProblemDetails>(TestContext.Current.CancellationToken))!.Errors.Keys);
        Assert.Equal(new UserPreferences(), await _alice.GetJsonAsync<UserPreferences>("/api/v1/account/preferences"));
    }

    [Fact]
    public async Task Only_the_offered_menu_text_sizes_week_starts_and_photo_sizes_are_accepted()
    {
        var size = await _alice.PutJsonAsync("/api/v1/account/preferences", new UserPreferences { MenuTextSize = "Huge" });
        var week = await _alice.PutJsonAsync("/api/v1/account/preferences", new UserPreferences { WeekStart = "Wednesday" });
        var photo = await _alice.PutJsonAsync("/api/v1/account/preferences", new UserPreferences { PhotoSize = "Tiny" });

        Assert.Contains("menuTextSize", (await size.Content.ReadFromJsonAsync<ValidationProblemDetails>(TestContext.Current.CancellationToken))!.Errors.Keys);
        Assert.Contains("weekStart", (await week.Content.ReadFromJsonAsync<ValidationProblemDetails>(TestContext.Current.CancellationToken))!.Errors.Keys);
        Assert.Contains("photoSize", (await photo.Content.ReadFromJsonAsync<ValidationProblemDetails>(TestContext.Current.CancellationToken))!.Errors.Keys);
    }

    [Theory]
    [InlineData("home,inbox")]
    [InlineData("home,todo,home")]
    [InlineData("home, todo")]
    [InlineData(",")]
    public async Task The_menu_order_names_each_known_item_at_most_once(string order)
    {
        var response = await _alice.PutJsonAsync("/api/v1/account/preferences", new UserPreferences { MenuOrder = order });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("menuOrder", (await response.Content.ReadFromJsonAsync<ValidationProblemDetails>(TestContext.Current.CancellationToken))!.Errors.Keys);
    }

    [Fact]
    public async Task A_full_menu_order_is_saved_as_it_is()
    {
        var order = string.Join(",", UserPreferences.MenuItems.Reverse());

        var response = await _alice.PutJsonAsync("/api/v1/account/preferences", new UserPreferences { MenuOrder = order });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(order, (await _alice.GetJsonAsync<UserPreferences>("/api/v1/account/preferences"))!.MenuOrder);
    }

    [Fact]
    public async Task Theme_and_accent_are_saved_and_checked()
    {
        var saved = await _alice.PutJsonAsync("/api/v1/account/preferences", new UserPreferences { Theme = "Dark", Accent = "Forest" });
        var badTheme = await _alice.PutJsonAsync("/api/v1/account/preferences", new UserPreferences { Theme = "Neon" });
        var badAccent = await _alice.PutJsonAsync("/api/v1/account/preferences", new UserPreferences { Accent = "#ff00ff" });

        Assert.Equal(HttpStatusCode.OK, saved.StatusCode);
        Assert.Contains("theme", (await badTheme.Content.ReadFromJsonAsync<ValidationProblemDetails>(TestContext.Current.CancellationToken))!.Errors.Keys);
        Assert.Contains("accent", (await badAccent.Content.ReadFromJsonAsync<ValidationProblemDetails>(TestContext.Current.CancellationToken))!.Errors.Keys);
        var stored = await _alice.GetJsonAsync<UserPreferences>("/api/v1/account/preferences");
        Assert.Equal(("Dark", "Forest"), (stored!.Theme, stored.Accent));
        Assert.Equal(("System", "Maple"), (new UserPreferences().Theme, new UserPreferences().Accent));
    }

    [Fact]
    public async Task Preferences_need_a_signed_in_user()
    {
        using var visitor = new ApiClient(_app);

        Assert.Equal(HttpStatusCode.Unauthorized, (await visitor.GetAsync("/api/v1/account/preferences")).StatusCode);
    }
}
