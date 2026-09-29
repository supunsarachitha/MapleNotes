using System.Diagnostics;
using System.Text;
using MapleNotes.Server.Infrastructure.Crypto;
using MapleNotes.Server.Tests.TestSupport;

namespace MapleNotes.Server.Tests.Hosting;

/// <summary>
/// Runs the built server as a real process, exactly as Docker does, to check what an operator sees.
/// </summary>
public sealed class CommandLineTests : IDisposable
{
    private readonly TempDirectory _dir = new();

    [Fact]
    public async Task Generate_key_prints_a_valid_master_key()
    {
        var (exitCode, stdout, _) = await RunServerAsync(["generate-key"], new Dictionary<string, string?>());

        Assert.Equal(0, exitCode);
        Assert.Equal(MasterKey.SizeBytes, Convert.FromBase64String(stdout.Trim()).Length);
    }

    [Fact]
    public async Task Refuses_to_start_without_a_master_key_and_says_how_to_fix_it()
    {
        var (exitCode, _, stderr) = await RunServerAsync([], new Dictionary<string, string?>
        {
            ["MAPLE_DATA_DIR"] = _dir.Path,
            ["MAPLE_MASTER_KEY"] = null,
            ["MAPLE_MASTER_KEY_FILE"] = null,
            ["ASPNETCORE_URLS"] = "http://127.0.0.1:0",
        });

        Assert.Equal(1, exitCode);
        Assert.Contains("Maple Notes cannot start: MAPLE_MASTER_KEY is not set", stderr, StringComparison.Ordinal);
        Assert.Contains("openssl rand -base64 32", stderr, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Backup_copies_the_live_database_while_the_server_runs()
    {
        await using var app = new MapleAppFactory();
        using var client = new ApiClient(app);
        await client.SignUpAsync("maple"); // the server is running and holds the database open

        var (exitCode, stdout, stderr) = await RunServerAsync(["backup"], new Dictionary<string, string?>
        {
            ["MAPLE_DATA_DIR"] = app.DataDirectory,
            ["MAPLE_MASTER_KEY"] = app.MasterKeyBase64,
        });

        Assert.True(exitCode == 0, stderr);
        var backup = stdout.Trim();
        Assert.Matches(@"maple-\d{8}-\d{6}-manual\.db$", backup);
        Assert.True(File.Exists(backup));
        Assert.NotEqual("SQLite format 3", Encoding.ASCII.GetString(File.ReadAllBytes(backup), 0, 15));
    }

    [Fact]
    public async Task Backup_refuses_to_create_an_empty_database()
    {
        var (exitCode, _, stderr) = await RunServerAsync(["backup"], new Dictionary<string, string?>
        {
            ["MAPLE_DATA_DIR"] = _dir.Path,
            ["MAPLE_MASTER_KEY"] = MasterKey.Generate(),
        });

        Assert.Equal(1, exitCode);
        Assert.Contains("There is no database", stderr, StringComparison.Ordinal);
        Assert.False(File.Exists(Path.Combine(_dir.Path, "maple.db")));
    }

    public void Dispose() => _dir.Dispose();

    private static async Task<(int ExitCode, string StdOut, string StdErr)> RunServerAsync(
        string[] arguments, Dictionary<string, string?> environment)
    {
        var start = new ProcessStartInfo("dotnet")
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
        };
        start.ArgumentList.Add(ServerAssemblyPath());
        foreach (var argument in arguments)
        {
            start.ArgumentList.Add(argument);
        }

        foreach (var (key, value) in environment)
        {
            if (value is null)
            {
                start.Environment.Remove(key);
            }
            else
            {
                start.Environment[key] = value;
            }
        }

        using var process = Process.Start(start)!;
        var stdout = process.StandardOutput.ReadToEndAsync();
        var stderr = process.StandardError.ReadToEndAsync();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(60));
        await process.WaitForExitAsync(timeout.Token);
        return (process.ExitCode, await stdout, await stderr);
    }

    /// <summary>The server's own build output (it has the runtime configuration needed to run it directly).</summary>
    private static string ServerAssemblyPath()
    {
        var testOutput = new DirectoryInfo(AppContext.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar));
        var configuration = testOutput.Parent!.Name; // .../bin/{Configuration}/net10.0
        var root = testOutput;
        while (root is not null && !File.Exists(Path.Combine(root.FullName, "MapleNotes.slnx")))
        {
            root = root.Parent;
        }

        var path = Path.Combine(root!.FullName, "src", "MapleNotes.Server", "bin", configuration, "net10.0", "MapleNotes.Server.dll");
        Assert.True(File.Exists(path), $"Server build output not found at {path}.");
        return path;
    }
}
