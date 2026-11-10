namespace MapleNotes.Server.Features.Auth;

/// <summary>
/// Counts failed sign-ins for usernames that have no account, in memory, so that an unknown name locks after
/// <see cref="AccountService.MaxFailedAttempts"/> failures exactly like a real account. Without it, five wrong
/// sign-ins answered 429 for a real account and 401 forever for an unknown one, which confirmed which names exist.
/// </summary>
/// <remarks>
/// The table is bounded by <see cref="Capacity"/>: when it is full, expired lockouts are dropped first and then the
/// entries least recently failed, so a flood of made-up names cannot exhaust memory. An evicted name starts counting
/// again, which a real account never does; telling the two apart that way needs more than
/// <see cref="Capacity"/> failed sign-ins in between, which the per-address and global limits make slow. The counts are
/// also lost on restart, which a remote client cannot cause.
/// </remarks>
/// <param name="time">Clock.</param>
public sealed class UnknownUsernameLockout(TimeProvider time)
{
    /// <summary>The most usernames tracked at once.</summary>
    public const int Capacity = 10_000;

    private readonly Lock _gate = new();
    private readonly Dictionary<string, Entry> _entries = new(StringComparer.Ordinal);

    /// <summary>How many usernames are being tracked (for tests).</summary>
    public int Count
    {
        get
        {
            lock (_gate)
            {
                return _entries.Count;
            }
        }
    }

    /// <summary>Returns the end of a current lockout of the unknown name, or null when it is not locked.</summary>
    /// <param name="normalizedUsername">The normalized username.</param>
    /// <returns>When the lockout ends, or null.</returns>
    public DateTime? LockedUntil(string normalizedUsername)
    {
        var now = time.GetUtcNow().UtcDateTime;
        lock (_gate)
        {
            return _entries.TryGetValue(normalizedUsername, out var entry) && entry.LockedUntilUtc > now ? entry.LockedUntilUtc : null;
        }
    }

    /// <summary>
    /// Counts a failed sign-in for an unknown name and, like <c>AccountService.RecordFailedAttemptAsync</c>, locks it
    /// on the <see cref="AccountService.MaxFailedAttempts"/>th failure and starts the count again.
    /// </summary>
    /// <param name="normalizedUsername">The normalized username.</param>
    /// <returns>The end of the lockout this failure started, or null when the name is not locked.</returns>
    public DateTime? RecordFailure(string normalizedUsername)
    {
        var now = time.GetUtcNow().UtcDateTime;
        lock (_gate)
        {
            if (!_entries.TryGetValue(normalizedUsername, out var entry))
            {
                MakeRoom(now);
                entry = new Entry();
                _entries[normalizedUsername] = entry;
            }

            entry.LastFailureUtc = now;
            entry.FailedCount++;
            if (entry.FailedCount < AccountService.MaxFailedAttempts)
            {
                return null;
            }

            entry.FailedCount = 0;
            entry.LockedUntilUtc = now + AccountService.LockoutDuration;
            return entry.LockedUntilUtc;
        }
    }

    private void MakeRoom(DateTime now)
    {
        if (_entries.Count < Capacity)
        {
            return;
        }

        foreach (var (name, entry) in _entries.Where(e => e.Value.FailedCount == 0 && e.Value.LockedUntilUtc <= now).ToList())
        {
            _entries.Remove(name);
        }

        if (_entries.Count < Capacity)
        {
            return;
        }

        // Still full: drop the tenth least recently failed, so this sort runs once per thousand new names at most.
        foreach (var name in _entries.OrderBy(e => e.Value.LastFailureUtc).Take(Capacity / 10).Select(e => e.Key).ToList())
        {
            _entries.Remove(name);
        }
    }

    private sealed class Entry
    {
        public int FailedCount { get; set; }

        public DateTime LockedUntilUtc { get; set; }

        public DateTime LastFailureUtc { get; set; }
    }
}

/// <summary>
/// Thrown when a password confirmation is refused because the account is locked after repeated failures. Converted to
/// HTTP 429 with a Retry-After header by <see cref="Infrastructure.Web.ApiExceptionFilter"/>, the same answer as a
/// locked sign-in.
/// </summary>
/// <param name="lockedUntilUtc">When the lockout ends.</param>
public sealed class AccountLockedException(DateTime lockedUntilUtc) : Exception("Too many failed sign-in attempts.")
{
    /// <summary>When the lockout ends.</summary>
    public DateTime LockedUntilUtc { get; } = lockedUntilUtc;
}
