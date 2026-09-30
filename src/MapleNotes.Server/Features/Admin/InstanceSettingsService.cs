using System.Globalization;
using MapleNotes.Server.Domain;
using MapleNotes.Server.Infrastructure.Configuration;
using MapleNotes.Server.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace MapleNotes.Server.Features.Admin;

/// <summary>
/// Instance-wide settings that administrators can change at runtime. Values saved in the database take precedence
/// over the environment defaults in <see cref="MapleOptions"/>.
/// </summary>
/// <param name="db">Database context.</param>
/// <param name="options">Environment defaults.</param>
public sealed class InstanceSettingsService(MapleDbContext db, MapleOptions options)
{
    /// <summary>Database key of the "open registration" setting.</summary>
    public const string AllowRegistrationKey = "AllowRegistration";

    /// <summary>Database key of the storage limit per account, in megabytes; absent when there is none.</summary>
    public const string StorageQuotaKey = "StorageQuotaMb";

    /// <summary>The largest storage limit per account an administrator can set, in megabytes (16 TB).</summary>
    public const int MaxStorageQuotaMb = 16 * 1024 * 1024;

    /// <summary>Returns whether visitors may create accounts.</summary>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>True when registration is open.</returns>
    public async Task<bool> IsRegistrationOpenAsync(CancellationToken cancellationToken)
    {
        var setting = await FindAsync(AllowRegistrationKey, cancellationToken);
        return setting is null ? options.AllowRegistration : bool.Parse(setting.Value);
    }

    /// <summary>Returns the most each account may store, notes and files together.</summary>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>The limit in megabytes, or null when there is none.</returns>
    public async Task<int?> GetStorageQuotaMbAsync(CancellationToken cancellationToken)
    {
        var setting = await FindAsync(StorageQuotaKey, cancellationToken);
        return setting is null ? null : int.Parse(setting.Value, CultureInfo.InvariantCulture);
    }

    /// <summary>Saves the settings.</summary>
    /// <param name="allowRegistration">True to let visitors create accounts.</param>
    /// <param name="storageQuotaMb">The storage limit per account in megabytes, or null for none.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>A task that completes when the settings are saved.</returns>
    public async Task SaveAsync(bool allowRegistration, int? storageQuotaMb, CancellationToken cancellationToken)
    {
        await SetAsync(AllowRegistrationKey, allowRegistration.ToString(), cancellationToken);
        await SetAsync(StorageQuotaKey, storageQuotaMb?.ToString(CultureInfo.InvariantCulture), cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
    }

    private Task<InstanceSetting?> FindAsync(string key, CancellationToken cancellationToken) =>
        db.InstanceSettings.AsNoTracking().SingleOrDefaultAsync(s => s.Key == key, cancellationToken);

    private async Task SetAsync(string key, string? value, CancellationToken cancellationToken)
    {
        var setting = await db.InstanceSettings.SingleOrDefaultAsync(s => s.Key == key, cancellationToken);
        if (value is null)
        {
            if (setting is not null)
            {
                db.InstanceSettings.Remove(setting);
            }
        }
        else if (setting is null)
        {
            db.InstanceSettings.Add(new InstanceSetting { Key = key, Value = value });
        }
        else
        {
            setting.Value = value;
        }
    }
}
