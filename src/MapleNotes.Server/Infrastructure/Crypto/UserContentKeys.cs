using MapleNotes.Server.Domain;
using MapleNotes.Server.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace MapleNotes.Server.Infrastructure.Crypto;

/// <summary>
/// Per-request access to users' server-held data keys and encryption modes.
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

    /// <summary>Returns the user's unwrapped server-held data key. Do not dispose it; the scope owns it.</summary>
    /// <param name="userId">The account.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>The data key.</returns>
    /// <exception cref="InvalidOperationException">The account has no server-held key (an end-to-end account whose
    /// content is all encrypted by the browser).</exception>
    public async Task<UserDataKey> GetKeyAsync(Guid userId, CancellationToken cancellationToken)
    {
        if (_keys.TryGetValue(userId, out var cached))
        {
            return cached;
        }

        var wrapped = await db.Users.AsNoTracking()
            .Where(u => u.Id == userId)
            .Select(u => u.WrappedDataKey)
            .SingleAsync(cancellationToken)
            ?? throw new InvalidOperationException($"Account {userId} has no server-held data key.");
        var key = dataKeys.Unwrap(userId, wrapped);
        _keys[userId] = key;
        return key;
    }

    /// <summary>Returns how new content of the user is protected.</summary>
    /// <param name="userId">The account.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>The user's encryption mode.</returns>
    public Task<EncryptionMode> GetModeAsync(Guid userId, CancellationToken cancellationToken) =>
        db.Users.AsNoTracking().Where(u => u.Id == userId).Select(u => u.EncryptionMode).SingleAsync(cancellationToken);

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
