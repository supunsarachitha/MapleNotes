using MapleNotes.Server.Domain;
using MapleNotes.Server.Infrastructure.Persistence;
using MapleNotes.Server.Infrastructure.Web;
using Microsoft.EntityFrameworkCore;

namespace MapleNotes.Server.Features.Preferences;

/// <summary>Reads and changes an account's preferences.</summary>
/// <param name="db">Database context.</param>
/// <param name="time">Clock.</param>
public sealed class PreferencesService(MapleDbContext db, TimeProvider time)
{
    /// <summary>Returns the account's preferences.</summary>
    /// <param name="userId">The account.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>The preferences; defaults for anything never changed.</returns>
    public Task<UserPreferences> GetAsync(Guid userId, CancellationToken cancellationToken) =>
        db.Users.AsNoTracking().Where(u => u.Id == userId).Select(u => u.Preferences).SingleAsync(cancellationToken);

    /// <summary>Replaces the account's preferences.</summary>
    /// <param name="userId">The account.</param>
    /// <param name="preferences">The complete new preferences.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>The saved preferences.</returns>
    /// <exception cref="ApiValidationException">A choice is not one of those offered, or the menu order names an unknown
    /// or repeated item.</exception>
    public async Task<UserPreferences> SetAsync(Guid userId, UserPreferences preferences, CancellationToken cancellationToken)
    {
        if (!UserPreferences.DateFormats.Contains(preferences.DateFormat, StringComparer.Ordinal))
        {
            throw new ApiValidationException("dateFormat", $"Choose one of: {string.Join(", ", UserPreferences.DateFormats)}.");
        }

        if (!UserPreferences.Themes.Contains(preferences.Theme, StringComparer.Ordinal))
        {
            throw new ApiValidationException("theme", $"Choose one of: {string.Join(", ", UserPreferences.Themes)}.");
        }

        if (!UserPreferences.Accents.Contains(preferences.Accent, StringComparer.Ordinal))
        {
            throw new ApiValidationException("accent", $"Choose one of: {string.Join(", ", UserPreferences.Accents)}.");
        }

        if (!UserPreferences.PhotoSizes.Contains(preferences.PhotoSize, StringComparer.Ordinal))
        {
            throw new ApiValidationException("photoSize", $"Choose one of: {string.Join(", ", UserPreferences.PhotoSizes)}.");
        }

        if (!UserPreferences.MenuTextSizes.Contains(preferences.MenuTextSize, StringComparer.Ordinal))
        {
            throw new ApiValidationException("menuTextSize", $"Choose one of: {string.Join(", ", UserPreferences.MenuTextSizes)}.");
        }

        if (!UserPreferences.WeekStarts.Contains(preferences.WeekStart, StringComparer.Ordinal))
        {
            throw new ApiValidationException("weekStart", $"Choose one of: {string.Join(", ", UserPreferences.WeekStarts)}.");
        }

        var menuOrder = preferences.MenuOrder ?? "";
        var items = menuOrder.Length == 0 ? [] : menuOrder.Split(',');
        if (!items.All(item => UserPreferences.MenuItems.Contains(item, StringComparer.Ordinal))
            || items.Distinct(StringComparer.Ordinal).Count() != items.Length)
        {
            throw new ApiValidationException(
                "menuOrder", $"List each of these at most once, separated by commas: {string.Join(",", UserPreferences.MenuItems)}.");
        }

        preferences = preferences with { MenuOrder = menuOrder };
        var user = await db.Users.SingleAsync(u => u.Id == userId, cancellationToken);
        user.Preferences = preferences;
        user.UpdatedAtUtc = time.GetUtcNow().UtcDateTime;
        await db.SaveChangesAsync(cancellationToken);
        return user.Preferences;
    }
}
