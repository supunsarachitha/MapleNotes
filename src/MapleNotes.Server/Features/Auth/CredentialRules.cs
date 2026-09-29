using System.Text.RegularExpressions;

namespace MapleNotes.Server.Features.Auth;

/// <summary>Validation rules for usernames and display names.</summary>
/// <remarks>
/// Password rules live in the web app (<c>src/maple-web/src/lib/auth.ts</c>): the password never reaches the server,
/// which receives only a key derived from it (see <see cref="KeyDerivation"/>).
/// </remarks>
public static partial class CredentialRules
{
    /// <summary>Maximum display name length.</summary>
    public const int MaxDisplayNameLength = 64;

    /// <summary>Returns the form of a username used for uniqueness checks and lookups.</summary>
    /// <param name="username">The username as typed.</param>
    /// <returns>The trimmed, upper-invariant username.</returns>
    public static string NormalizeUsername(string username) => username.Trim().ToUpperInvariant();

    /// <summary>Validates the fields of a new account.</summary>
    /// <param name="username">Requested username.</param>
    /// <param name="displayName">Optional display name.</param>
    /// <returns>Errors keyed by field name; empty when valid.</returns>
    public static Dictionary<string, string[]> ValidateNewAccount(string? username, string? displayName)
    {
        var errors = new Dictionary<string, string[]>();
        if (!UsernamePattern().IsMatch(username?.Trim() ?? string.Empty))
        {
            errors["username"] =
                ["Use 3–32 characters: letters, digits, dots, dashes or underscores, starting with a letter or digit."];
        }

        if (displayName is not null && displayName.Trim().Length > MaxDisplayNameLength)
        {
            errors["displayName"] = [$"Use at most {MaxDisplayNameLength} characters."];
        }

        return errors;
    }

    [GeneratedRegex("^[A-Za-z0-9][A-Za-z0-9._-]{2,31}$", RegexOptions.CultureInvariant)]
    private static partial Regex UsernamePattern();
}
