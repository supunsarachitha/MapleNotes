using System.Data.Common;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace MapleNotes.Server.Tests.TestSupport;

/// <summary>
/// Holds every write to the <c>Users</c> table until a set number of requests have reached one, so that requests sent
/// together have all read the account before any of them writes it. This makes a race between parallel requests happen
/// on every run instead of only sometimes. Unarmed, it lets everything through.
/// </summary>
internal sealed class UserUpdateGate : DbCommandInterceptor
{
    private static readonly TimeSpan MaxWait = TimeSpan.FromSeconds(10);

    private TaskCompletionSource _open = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private int _expected;
    private int _arrived;

    /// <summary>Whether the last armed gate opened because all requests arrived (rather than after the time limit).</summary>
    public bool OpenedByArrivals { get; private set; }

    /// <summary>Holds the next writes to <c>Users</c> until <paramref name="requests"/> of them are waiting.</summary>
    public void Arm(int requests)
    {
        _open = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        _arrived = 0;
        OpenedByArrivals = false;
        Volatile.Write(ref _expected, requests);
    }

    public override async ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(
        DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result, CancellationToken cancellationToken = default)
    {
        await WaitAsync(command, cancellationToken);
        return result;
    }

    public override async ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(
        DbCommand command, CommandEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
    {
        await WaitAsync(command, cancellationToken);
        return result;
    }

    public override async ValueTask<InterceptionResult<object>> ScalarExecutingAsync(
        DbCommand command, CommandEventData eventData, InterceptionResult<object> result, CancellationToken cancellationToken = default)
    {
        await WaitAsync(command, cancellationToken);
        return result;
    }

    private async Task WaitAsync(DbCommand command, CancellationToken cancellationToken)
    {
        var expected = Volatile.Read(ref _expected);
        if (expected == 0 || !command.CommandText.Contains("UPDATE \"Users\"", StringComparison.Ordinal))
        {
            return;
        }

        var open = _open;
        if (Interlocked.Increment(ref _arrived) == expected)
        {
            OpenedByArrivals = true;
            Volatile.Write(ref _expected, 0); // later writes pass straight through
            open.TrySetResult();
        }

        try
        {
            await open.Task.WaitAsync(MaxWait, cancellationToken);
        }
        catch (TimeoutException)
        {
            // Not every request got here (one was refused earlier, or blocked elsewhere): go on rather than hang.
            Volatile.Write(ref _expected, 0);
        }
    }
}
