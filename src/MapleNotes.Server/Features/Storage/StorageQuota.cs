using System.Collections.Concurrent;
using MapleNotes.Server.Features.Admin;
using MapleNotes.Server.Infrastructure.Web;

namespace MapleNotes.Server.Features.Storage;

/// <summary>
/// The storage limit an administrator can set for every account: notes and files together, counted the way the
/// account's own usage counts them. A change that would take an account past it is refused with HTTP 507. Anything that
/// frees space is always allowed, and so is converting content between encryption modes. An account already over a
/// new, lower limit keeps what it has.
/// </summary>
/// <param name="settings">Instance settings, which hold the limit.</param>
/// <param name="storage">Measures an account's usage.</param>
/// <param name="locks">One lock per account.</param>
public sealed class StorageQuota(InstanceSettingsService settings, StorageService storage, StorageQuotaLocks locks)
{
    /// <summary>Returns the most each account may store.</summary>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>The limit in bytes, or null when there is none.</returns>
    public async Task<long?> GetLimitBytesAsync(CancellationToken cancellationToken) =>
        await settings.GetStorageQuotaMbAsync(cancellationToken) is { } megabytes ? megabytes * 1024L * 1024 : null;

    /// <summary>Returns how many more bytes an account may store.</summary>
    /// <param name="userId">The account.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>The room left (zero when the account is full or over the limit), or null when there is no limit.</returns>
    public async Task<long?> GetRoomAsync(Guid userId, CancellationToken cancellationToken)
    {
        if (await GetLimitBytesAsync(cancellationToken) is not { } limit)
        {
            return null;
        }

        var used = (await storage.GetUsageAsync(userId, cancellationToken)).TotalBytes;
        return Math.Max(limit - used, 0);
    }

    /// <summary>
    /// Waits for the account's turn, then checks that <paramref name="additionalBytes"/> more fit. Hold the returned
    /// lease until the change is saved: an account's changes are checked and saved one at a time, so two at once cannot
    /// both take the last of the room.
    /// </summary>
    /// <param name="userId">The account.</param>
    /// <param name="additionalBytes">How much the change adds; zero or less for a change that adds nothing.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>The lease to dispose of once the change is saved (or abandoned).</returns>
    /// <exception cref="ApiProblemException">The change does not fit (HTTP 507).</exception>
    public async Task<IAsyncDisposable> ClaimAsync(Guid userId, long additionalBytes, CancellationToken cancellationToken)
    {
        if (additionalBytes <= 0 || await GetLimitBytesAsync(cancellationToken) is not { } limit)
        {
            return NoLease.Instance;
        }

        var gate = locks.For(userId);
        await gate.WaitAsync(cancellationToken);
        try
        {
            var used = (await storage.GetUsageAsync(userId, cancellationToken)).TotalBytes;
            if (used + additionalBytes > limit)
            {
                throw Full();
            }

            return new Lease(gate);
        }
        catch
        {
            gate.Release();
            throw;
        }
    }

    /// <summary>The problem for a change that does not fit in the account's storage.</summary>
    /// <returns>An HTTP 507 problem.</returns>
    public static ApiProblemException Full() => new(
        StatusCodes.Status507InsufficientStorage,
        "There is not enough room in your storage.",
        "Delete notes or files to make room, or ask an administrator for more space.");

    private sealed class Lease(SemaphoreSlim gate) : IAsyncDisposable
    {
        private int _released;

        public ValueTask DisposeAsync()
        {
            if (Interlocked.Exchange(ref _released, 1) == 0)
            {
                gate.Release();
            }

            return ValueTask.CompletedTask;
        }
    }

    private sealed class NoLease : IAsyncDisposable
    {
        public static readonly NoLease Instance = new();

        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
    }
}

/// <summary>One lock per account, so that storage limit checks and the saves they guard run one at a time per account.</summary>
public sealed class StorageQuotaLocks
{
    private readonly ConcurrentDictionary<Guid, SemaphoreSlim> _locks = new();

    /// <summary>Returns the account's lock.</summary>
    /// <param name="userId">The account.</param>
    /// <returns>Its lock.</returns>
    public SemaphoreSlim For(Guid userId) => _locks.GetOrAdd(userId, _ => new SemaphoreSlim(1, 1));
}
