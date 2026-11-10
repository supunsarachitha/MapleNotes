using MapleNotes.Server.Domain;

namespace MapleNotes.Server.Features.Auth;

/// <summary>
/// Turns a User-Agent header into a short description such as "Firefox on Windows" for the list of signed-in
/// devices. Only the browser family and the system are kept: the full header is noise to the account owner and
/// would be one more fingerprint to store.
/// </summary>
public static class DeviceDescription
{
    // Checked in order: Edge and Opera also send "Chrome/", and Chrome also sends "Safari/".
    private static readonly (string Token, string Name)[] Browsers =
    [
        ("Edg/", "Edge"), ("EdgA/", "Edge"), ("EdgiOS/", "Edge"), ("OPR/", "Opera"), ("SamsungBrowser/", "Samsung Internet"),
        ("Firefox/", "Firefox"), ("FxiOS/", "Firefox"), ("CriOS/", "Chrome"), ("Chrome/", "Chrome"), ("Safari/", "Safari"),
    ];

    private static readonly (string Token, string Name)[] Systems =
    [
        ("iPhone", "iOS"), ("iPad", "iPadOS"), ("Android", "Android"), ("CrOS", "ChromeOS"), ("Windows", "Windows"),
        ("Mac OS X", "macOS"), ("Macintosh", "macOS"), ("Linux", "Linux"),
    ];

    /// <summary>Describes the client that sent <paramref name="userAgent"/>.</summary>
    /// <param name="userAgent">The User-Agent header (may be empty).</param>
    /// <returns>A description of at most <see cref="Session.MaxDeviceLength"/> characters.</returns>
    public static string FromUserAgent(string? userAgent)
    {
        if (string.IsNullOrWhiteSpace(userAgent))
        {
            return "Unknown device";
        }

        var browser = Browsers.FirstOrDefault(b => userAgent.Contains(b.Token, StringComparison.Ordinal)).Name;
        var system = Systems.FirstOrDefault(s => userAgent.Contains(s.Token, StringComparison.Ordinal)).Name;
        if (browser is null && !userAgent.StartsWith("Mozilla/", StringComparison.Ordinal))
        {
            // An API client (a script, Falcon Notes): its own product name is the clearest description.
            browser = new string(userAgent.TakeWhile(c => c is not ('/' or ' ') && !char.IsControl(c)).Take(40).ToArray());
        }

        var description = (browser, system) switch
        {
            ({ Length: > 0 }, not null) => $"{browser} on {system}",
            ({ Length: > 0 }, null) => browser,
            (_, not null) => $"Browser on {system}",
            _ => "Unknown device",
        };
        return description.Length <= Session.MaxDeviceLength ? description : description[..Session.MaxDeviceLength];
    }
}
