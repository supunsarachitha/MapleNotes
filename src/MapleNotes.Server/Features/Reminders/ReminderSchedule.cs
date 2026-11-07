using MapleNotes.Server.Domain;

namespace MapleNotes.Server.Features.Reminders;

/// <summary>When a reminder goes off: its occurrences in local time, turned into UTC instants.</summary>
public static class ReminderSchedule
{
    /// <summary>
    /// The first occurrence strictly after <paramref name="afterUtc"/>, or null for a one-off reminder whose time has
    /// passed. Occurrence n is the start plus n days, weeks or months in local time (months from the start, so a
    /// reminder on the 31st falls on the 30th in April and on the 31st again in May).
    /// </summary>
    /// <param name="startLocal">The first local date and time.</param>
    /// <param name="zone">Its time zone.</param>
    /// <param name="repeat">How it repeats.</param>
    /// <param name="afterUtc">Only occurrences after this instant count.</param>
    /// <returns>The next occurrence in UTC, or null.</returns>
    public static DateTime? Next(DateTime startLocal, TimeZoneInfo zone, ReminderRepeat repeat, DateTime afterUtc)
    {
        if (repeat == ReminderRepeat.None)
        {
            var once = ToUtc(startLocal, zone);
            return once > afterUtc ? once : null;
        }

        // Jump close to afterUtc first, then step, so a reminder set long ago does not walk through every occurrence.
        var afterLocal = TimeZoneInfo.ConvertTimeFromUtc(afterUtc, zone);
        var n = repeat switch
        {
            ReminderRepeat.Daily => Math.Max(0, (int)(afterLocal - startLocal).TotalDays - 1),
            ReminderRepeat.Weekly => Math.Max(0, (int)((afterLocal - startLocal).TotalDays / 7) - 1),
            _ => Math.Max(0, ((afterLocal.Year - startLocal.Year) * 12) + afterLocal.Month - startLocal.Month - 1),
        };
        for (; ; n++)
        {
            var local = repeat switch
            {
                ReminderRepeat.Daily => startLocal.AddDays(n),
                ReminderRepeat.Weekly => startLocal.AddDays(7 * n),
                _ => startLocal.AddMonths(n),
            };
            var utc = ToUtc(local, zone);
            if (utc > afterUtc)
            {
                return utc;
            }
        }
    }

    /// <summary>
    /// A local time as UTC. A time skipped by a daylight-saving change (02:30 on the spring-forward night) moves an hour
    /// later; a repeated one (the fall-back night) uses its first occurrence.
    /// </summary>
    /// <param name="local">The local date and time.</param>
    /// <param name="zone">Its time zone.</param>
    /// <returns>The instant.</returns>
    public static DateTime ToUtc(DateTime local, TimeZoneInfo zone)
    {
        local = DateTime.SpecifyKind(local, DateTimeKind.Unspecified);
        if (zone.IsInvalidTime(local))
        {
            local = local.AddHours(1);
        }

        if (zone.IsAmbiguousTime(local))
        {
            var offsets = zone.GetAmbiguousTimeOffsets(local);
            return DateTime.SpecifyKind(local - offsets.Max(), DateTimeKind.Utc);
        }

        return TimeZoneInfo.ConvertTimeToUtc(local, zone);
    }
}
