using System.Collections.Concurrent;
using System.Security.Cryptography;

namespace MapleNotes.Server.Features.Passkeys;

/// <summary>
/// One-time passkey challenges, kept in memory for five minutes. Each is taken out when it is answered, so a captured
/// answer cannot be sent again (synced passkeys report no counter that would catch it).
/// </summary>
/// <param name="time">Clock.</param>
public sealed class PasskeyChallenges(TimeProvider time)
{
    /// <summary>How long a challenge can be answered.</summary>
    public static readonly TimeSpan Lifetime = TimeSpan.FromMinutes(5);

    /// <summary>The most challenges kept at once; past it the oldest pending ones are dropped.</summary>
    public const int MaxPending = 10_000;

    private readonly ConcurrentDictionary<string, Entry> _pending = new(StringComparer.Ordinal);

    /// <summary>What a challenge is for.</summary>
    public enum Purpose
    {
        /// <summary>Adding a passkey to a signed-in account.</summary>
        Register,

        /// <summary>Signing in.</summary>
        SignIn,
    }

    /// <summary>Issues a challenge.</summary>
    /// <param name="purpose">What it is for.</param>
    /// <param name="userId">The account adding a passkey, or null for sign-in.</param>
    /// <param name="rpId">The relying-party ID.</param>
    /// <param name="origin">The expected origin.</param>
    /// <returns>The handle the browser sends back, and the ceremony.</returns>
    public (string Id, Ceremony Ceremony) Issue(Purpose purpose, Guid? userId, string rpId, string origin)
    {
        var now = time.GetUtcNow();
        if (_pending.Count >= MaxPending)
        {
            Prune(now);
        }

        var id = WebAuthn.Base64Url(RandomNumberGenerator.GetBytes(16));
        var ceremony = new Ceremony(RandomNumberGenerator.GetBytes(32), rpId, origin);
        _pending[id] = new Entry(purpose, userId, ceremony, now + Lifetime);
        return (id, ceremony);
    }

    /// <summary>Takes a challenge out, if it exists, has not expired, and matches the purpose and account.</summary>
    /// <param name="id">The handle.</param>
    /// <param name="purpose">What it must be for.</param>
    /// <param name="userId">The account that must have asked for it, or null for sign-in.</param>
    /// <returns>The ceremony, or null.</returns>
    public Ceremony? Take(string? id, Purpose purpose, Guid? userId)
    {
        if (string.IsNullOrEmpty(id) || !_pending.TryRemove(id, out var entry))
        {
            return null;
        }

        return entry.Purpose == purpose && entry.UserId == userId && entry.ExpiresAt > time.GetUtcNow() ? entry.Ceremony : null;
    }

    private void Prune(DateTimeOffset now)
    {
        foreach (var (key, entry) in _pending)
        {
            if (entry.ExpiresAt <= now)
            {
                _pending.TryRemove(key, out _);
            }
        }

        // Still full of live entries (a flood of requests): drop the ones closest to expiring.
        var excess = _pending.Count - (MaxPending * 9 / 10);
        foreach (var (key, _) in _pending.OrderBy(p => p.Value.ExpiresAt).Take(Math.Max(0, excess)))
        {
            _pending.TryRemove(key, out _);
        }
    }

    private sealed record Entry(Purpose Purpose, Guid? UserId, Ceremony Ceremony, DateTimeOffset ExpiresAt);
}
