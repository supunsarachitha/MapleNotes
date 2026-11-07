namespace MapleNotes.Server.Domain;

/// <summary>How a reminder repeats.</summary>
public enum ReminderRepeat
{
    /// <summary>Once.</summary>
    None,

    /// <summary>Every day at the same local time.</summary>
    Daily,

    /// <summary>Every week on the same weekday and local time.</summary>
    Weekly,

    /// <summary>Every month on the same day (or the month's last day when it is shorter) and local time.</summary>
    Monthly,
}

/// <summary>
/// A note's reminder (at most one per note). The time is kept as the local date and time the owner chose, in their time
/// zone, so repeats stay at that local time across daylight-saving changes; <see cref="NextAtUtc"/> is the next one.
/// A one-off reminder is removed once it has been sent.
/// </summary>
public sealed class NoteReminder
{
    /// <summary>The note (and the key).</summary>
    public Guid NoteId { get; init; }

    /// <summary>The note's owner.</summary>
    public Guid UserId { get; init; }

    /// <summary>The first time chosen, as a local date and time in <see cref="TimeZone"/>.</summary>
    public DateTime StartLocal { get; set; }

    /// <summary>The IANA time zone <see cref="StartLocal"/> is in.</summary>
    public required string TimeZone { get; set; }

    /// <summary>How it repeats.</summary>
    public ReminderRepeat Repeat { get; set; }

    /// <summary>When it next goes off.</summary>
    public DateTime NextAtUtc { get; set; }

    /// <summary>When it last went off, if it has.</summary>
    public DateTime? LastSentAtUtc { get; set; }
}
