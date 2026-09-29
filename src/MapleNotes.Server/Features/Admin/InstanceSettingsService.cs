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

    /// <summary>Returns whether visitors may create accounts.</summary>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>True when registration is open.</returns>
    public async Task<bool> IsRegistrationOpenAsync(CancellationToken cancellationToken)
    {
        var setting = await db.InstanceSettings.AsNoTracking()
            .SingleOrDefaultAsync(s => s.Key == AllowRegistrationKey, cancellationToken);
        return setting is null ? options.AllowRegistration : bool.Parse(setting.Value);
    }

    /// <summary>Opens or closes registration.</summary>
    /// <param name="open">True to let visitors create accounts.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>A task that completes when the setting is saved.</returns>
    public async Task SetRegistrationOpenAsync(bool open, CancellationToken cancellationToken)
    {
        var setting = await db.InstanceSettings.SingleOrDefaultAsync(s => s.Key == AllowRegistrationKey, cancellationToken);
        if (setting is null)
        {
            db.InstanceSettings.Add(new InstanceSetting { Key = AllowRegistrationKey, Value = open.ToString() });
        }
        else
        {
            setting.Value = open.ToString();
        }

        await db.SaveChangesAsync(cancellationToken);
    }
}
