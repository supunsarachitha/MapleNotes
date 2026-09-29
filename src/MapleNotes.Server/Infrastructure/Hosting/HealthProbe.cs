namespace MapleNotes.Server.Infrastructure.Hosting;

/// <summary>
/// Minimal HTTP self-probe used as the container health check.
/// </summary>
/// <remarks>
/// The runtime image is a "chiseled" Ubuntu image with no shell, curl or wget. Docker's <c>HEALTHCHECK</c> therefore
/// runs <c>dotnet MapleNotes.Server.dll --healthcheck</c>, which starts a short-lived process that calls the running
/// server's <c>/healthz</c> endpoint and reports the result through its exit code.
/// </remarks>
internal static class HealthProbe
{
    /// <summary>Command-line switch that runs the probe instead of starting the web server.</summary>
    public const string CommandLineSwitch = "--healthcheck";

    private const int DefaultPort = 8080;

    /// <summary>
    /// Calls <c>http://127.0.0.1:{port}/healthz</c> on the local server.
    /// </summary>
    /// <returns><c>0</c> when the server reports healthy; <c>1</c> otherwise (Docker's convention).</returns>
    public static async Task<int> RunAsync()
    {
        var port = ResolvePort(Environment.GetEnvironmentVariable("ASPNETCORE_HTTP_PORTS"));
        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(3) };

        try
        {
            using var response = await http.GetAsync(new Uri($"http://127.0.0.1:{port}/healthz"));
            return response.IsSuccessStatusCode ? 0 : 1;
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            await Console.Error.WriteLineAsync($"Health probe failed: {ex.Message}");
            return 1;
        }
    }

    /// <summary>
    /// Picks the port to probe from the <c>ASPNETCORE_HTTP_PORTS</c> value (for example <c>"8080"</c> or
    /// <c>"8080;8081"</c>), falling back to 8080 when it is missing or invalid.
    /// </summary>
    /// <param name="httpPorts">Raw value of <c>ASPNETCORE_HTTP_PORTS</c>.</param>
    /// <returns>The first valid TCP port listed, or 8080.</returns>
    internal static int ResolvePort(string? httpPorts)
    {
        var first = httpPorts?
            .Split([';', ','], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .FirstOrDefault();

        return int.TryParse(first, out var port) && port is > 0 and <= 65535 ? port : DefaultPort;
    }
}
