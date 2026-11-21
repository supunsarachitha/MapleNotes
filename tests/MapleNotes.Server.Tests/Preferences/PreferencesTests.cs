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
        Assert.Equal((false, "", 10), (preferences.Budgets, preferences.BudgetCurrency, preferences.BudgetSurprisePercent)); // budgets too
        Assert.False(preferences.ShrinkPhotos); // so is shrinking photos, which replaces the original
        Assert.Equal((true, true, "Medium", "Auto"), (preferences.Archive, preferences.Tags, preferences.MenuTextSize, preferences.WeekStart));
        Assert.Equal("Medium", preferences.NoteTextSize);
        Assert.Equal(30, preferences.TrashDays); // as before the choice existed
        Assert.Equal("", preferences.TimeZone); // Automatic
        Assert.Equal((false, false), (preferences.QuickNoteTitles, preferences.DoubleTapToEdit)); // both opt-in
        Assert.Equal((false, false, true, ""), (preferences.TagSuggestions, preferences.Labels, preferences.Trash, preferences.MenuOrder));
        Assert.False(preferences.OpenFullScreen); // opt-in
        Assert.True(preferences.HelpMenu);
        Assert.Equal("", preferences.DailyNoteTemplate); // no template until one is chosen
        Assert.Equal("", preferences.DefaultLabels); // new notes start without labels
        Assert.Equal("Large", preferences.PhotoSize); // as photos were shrunk before sizes could be chosen
        Assert.Equal(preferences, (await _alice.GetJsonAsync<UserResponse>("/api/v1/auth/me"))!.Preferences);
    }

    [Fact]
    public async Task Saved_preferences_come_back_with_the_user_and_are_per_account()
    {
        var wanted = new UserPreferences
        {
            NoteTitles = true, DateInTitles = true, DateFormat = "dddd, d MMMM yyyy", TodoLists = false, QuickNotes = false, DailyNotes = true,
            HabitTracker = true, ShrinkPhotos = true, Archive = false, Tags = false, MenuTextSize = "Large", NoteTextSize = "Small", TrashDays = 90, WeekStart = "Monday", TimeZone = "Asia/Colombo",
            QuickNoteTitles = true, DoubleTapToEdit = true, TagSuggestions = true, OpenFullScreen = true, Labels = true, Trash = false, MenuOrder = "help,home,todo",
            HelpMenu = false, PhotoSize = "Small", DailyNoteTemplate = Guid.CreateVersion7().ToString(),
            DefaultLabels = $"{Guid.CreateVersion7()},{Guid.CreateVersion7()}",
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
        var noteSize = await _alice.PutJsonAsync("/api/v1/account/preferences", new UserPreferences { NoteTextSize = "Tiny" });
        var trashDays = await _alice.PutJsonAsync("/api/v1/account/preferences", new UserPreferences { TrashDays = 5 });
        var timeZone = await _alice.PutJsonAsync("/api/v1/account/preferences", new UserPreferences { TimeZone = "Mars/Olympus_Mons" });
        var windowsZone = await _alice.PutJsonAsync("/api/v1/account/preferences", new UserPreferences { TimeZone = "Pacific Standard Time" });
        var photo = await _alice.PutJsonAsync("/api/v1/account/preferences", new UserPreferences { PhotoSize = "Tiny" });

        Assert.Contains("menuTextSize", (await size.Content.ReadFromJsonAsync<ValidationProblemDetails>(TestContext.Current.CancellationToken))!.Errors.Keys);
        Assert.Contains("timeZone", (await timeZone.Content.ReadFromJsonAsync<ValidationProblemDetails>(TestContext.Current.CancellationToken))!.Errors.Keys);
        Assert.Contains("timeZone", (await windowsZone.Content.ReadFromJsonAsync<ValidationProblemDetails>(TestContext.Current.CancellationToken))!.Errors.Keys);
        Assert.Contains("trashDays", (await trashDays.Content.ReadFromJsonAsync<ValidationProblemDetails>(TestContext.Current.CancellationToken))!.Errors.Keys);
        Assert.Contains("noteTextSize", (await noteSize.Content.ReadFromJsonAsync<ValidationProblemDetails>(TestContext.Current.CancellationToken))!.Errors.Keys);
        Assert.Contains("weekStart", (await week.Content.ReadFromJsonAsync<ValidationProblemDetails>(TestContext.Current.CancellationToken))!.Errors.Keys);
        Assert.Contains("photoSize", (await photo.Content.ReadFromJsonAsync<ValidationProblemDetails>(TestContext.Current.CancellationToken))!.Errors.Keys);
    }

    [Fact]
    public async Task Budget_currency_and_surprise_percentage_are_saved_and_checked()
    {
        var saved = await _alice.PutJsonAsync("/api/v1/account/preferences",
            new UserPreferences { Budgets = true, BudgetCurrency = " lkr ", BudgetSurprisePercent = 15 });
        var back = await _alice.GetJsonAsync<UserPreferences>("/api/v1/account/preferences");
        var none = await _alice.PutJsonAsync("/api/v1/account/preferences", new UserPreferences { BudgetSurprisePercent = 0 });

        Assert.Equal(HttpStatusCode.OK, saved.StatusCode);
        Assert.Equal((true, "LKR", 15), (back!.Budgets, back.BudgetCurrency, back.BudgetSurprisePercent)); // code is tidied up
        Assert.Equal(HttpStatusCode.OK, none.StatusCode); // 0 turns the allowance off

        foreach (var (wrong, field) in new (UserPreferences, string)[]
        {
            (new UserPreferences { BudgetCurrency = "RUPEE" }, "budgetCurrency"),
            (new UserPreferences { BudgetCurrency = "L1R" }, "budgetCurrency"),
            (new UserPreferences { BudgetSurprisePercent = -1 }, "budgetSurprisePercent"),
            (new UserPreferences { BudgetSurprisePercent = 101 }, "budgetSurprisePercent"),
        })
        {
            var response = await _alice.PutJsonAsync("/api/v1/account/preferences", wrong);
            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
            Assert.Contains(field, (await response.Content.ReadFromJsonAsync<ValidationProblemDetails>(TestContext.Current.CancellationToken))!.Errors.Keys);
        }
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

    [Theory]
    [InlineData("today")]
    [InlineData("0199a1b2c3d4e5f60718293a4b5c6d7e")]
    [InlineData("{0199a1b2-c3d4-e5f6-0718-293a4b5c6d7e}")]
    public async Task The_daily_note_template_is_a_note_id_or_nothing(string template)
    {
        var response = await _alice.PutJsonAsync("/api/v1/account/preferences", new UserPreferences { DailyNoteTemplate = template });
        var upperCase = await _alice.PutJsonAsync("/api/v1/account/preferences",
            new UserPreferences { DailyNoteTemplate = "0199A1B2-C3D4-E5F6-0718-293A4B5C6D7E" });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("dailyNoteTemplate", (await response.Content.ReadFromJsonAsync<ValidationProblemDetails>(TestContext.Current.CancellationToken))!.Errors.Keys);
        Assert.Equal("0199a1b2-c3d4-e5f6-0718-293a4b5c6d7e", (await _alice.GetJsonAsync<UserPreferences>("/api/v1/account/preferences"))!.DailyNoteTemplate);
        Assert.Equal(HttpStatusCode.OK, upperCase.StatusCode);
    }

    [Theory]
    [InlineData("work")]
    [InlineData("0199a1b2-c3d4-e5f6-0718-293a4b5c6d7e,0199A1B2-C3D4-E5F6-0718-293A4B5C6D7E")]
    [InlineData("0199a1b2-c3d4-e5f6-0718-293a4b5c6d7e,")]
    public async Task Default_labels_are_different_label_ids_or_nothing(string defaultLabels)
    {
        var response = await _alice.PutJsonAsync("/api/v1/account/preferences", new UserPreferences { DefaultLabels = defaultLabels });
        var upperCase = await _alice.PutJsonAsync("/api/v1/account/preferences",
            new UserPreferences { DefaultLabels = "0199A1B2-C3D4-E5F6-0718-293A4B5C6D7E" });
        var tooMany = await _alice.PutJsonAsync("/api/v1/account/preferences",
            new UserPreferences { DefaultLabels = string.Join(",", Enumerable.Range(0, Label.MaxPerNote + 1).Select(_ => Guid.CreateVersion7())) });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("defaultLabels", (await response.Content.ReadFromJsonAsync<ValidationProblemDetails>(TestContext.Current.CancellationToken))!.Errors.Keys);
        Assert.Equal(HttpStatusCode.OK, upperCase.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, tooMany.StatusCode);
        Assert.Equal("0199a1b2-c3d4-e5f6-0718-293a4b5c6d7e", (await _alice.GetJsonAsync<UserPreferences>("/api/v1/account/preferences"))!.DefaultLabels);
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
