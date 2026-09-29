using MapleNotes.Server.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace MapleNotes.Server.Infrastructure.Crypto;

/// <summary>
/// Per-request access to users' data keys and encryption settings.
/// </summary>
/// <remarks>
/// Registered as a scoped service: each key is unwrapped at most once per request and wiped from memory when the
/// request ends (the scope disposes this object).
/// </remarks>
/// <param name="db">Database context.</param>
/// <param name="dataKeys">Unwraps stored data keys.</param>
public sealed class UserContentKeys(MapleDbContext db, DataKeyService dataKeys) : IDisposable
{
    private readonly Dictionary<Guid, UserDataKey> _keys = [];

    /// <summary>Returns the user's unwrapped data key. Do not dispose it; the scope owns it.</summary>
    /// <param name="userId">The account.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>The data key.</returns>
    public async Task<UserDataKey> GetKeyAsync(Guid userId, CancellationToken cancellationToken)
    {
        if (_keys.TryGetValue(userId, out var cached))
        {
            return cached;
        }

        var wrapped = await db.Users.AsNoTracking()
            .Where(u => u.Id == userId)
            .Select(u => u.WrappedDataKey)
            .SingleAsync(cancellationToken);
        var key = dataKeys.Unwrap(userId, wrapped);
        _keys[userId] = key;
        return key;
    }

    /// <summary>Returns whether new content of the user should be encrypted.</summary>
    /// <param name="userId">The account.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>The user's encryption-at-rest setting.</returns>
    public Task<bool> IsEncryptionEnabledAsync(Guid userId, CancellationToken cancellationToken) =>
        db.Users.AsNoTracking().Where(u => u.Id == userId).Select(u => u.EncryptionEnabled).SingleAsync(cancellationToken);

    /// <summary>Wipes every key unwrapped during this scope.</summary>
    public void Dispose()
    {
        foreach (var key in _keys.Values)
        {
            key.Dispose();
        }

        _keys.Clear();
    }
}
