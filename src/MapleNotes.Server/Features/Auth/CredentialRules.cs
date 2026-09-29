using System.Text.RegularExpressions;

namespace MapleNotes.Server.Features.Auth;

/// <summary>Validation rules for usernames, display names and passwords.</summary>
public static partial class CredentialRules
{
    /// <summary>Minimum password length. Length matters more than character classes (NIST SP 800-63B).</summary>
    public const int MinPasswordLength = 10;

    /// <summary>Maximum password length, which bounds hashing cost.</summary>
    public const int MaxPasswordLength = 256;

    /// <summary>Maximum display name length.</summary>
    public const int MaxDisplayNameLength = 64;

    /// <summary>Returns the form of a username used for uniqueness checks and lookups.</summary>
    /// <param name="username">The username as typed.</param>
    /// <returns>The trimmed, upper-invariant username.</returns>
    public static string NormalizeUsername(string username) => username.Trim().ToUpperInvariant();

    /// <summary>Validates the fields of a new account.</summary>
    /// <param name="username">Requested username.</param>
    /// <param name="password">Requested password.</param>
    /// <param name="displayName">Optional display name.</param>
    /// <returns>Errors keyed by field name; empty when valid.</returns>
    public static Dictionary<string, string[]> ValidateNewAccount(string? username, string? password, string? displayName)
    {
        var errors = new Dictionary<string, string[]>();
        if (!UsernamePattern().IsMatch(username?.Trim() ?? string.Empty))
        {
            errors["username"] =
                ["Use 3–32 characters: letters, digits, dots, dashes or underscores, starting with a letter or digit."];
        }

        if (ValidatePassword(password) is { } passwordError)
        {
            errors["password"] = [passwordError];
        }

        if (displayName is not null && displayName.Trim().Length > MaxDisplayNameLength)
        {
            errors["displayName"] = [$"Use at most {MaxDisplayNameLength} characters."];
        }

        return errors;
    }

    /// <summary>Validates a new password.</summary>
    /// <param name="password">The password.</param>
    /// <returns>An error message, or null when the password is acceptable.</returns>
    public static string? ValidatePassword(string? password)
    {
        if (string.IsNullOrWhiteSpace(password) || password.Length < MinPasswordLength)
        {
            return $"Use at least {MinPasswordLength} characters. A few random words make a strong, memorable password.";
        }

        return password.Length > MaxPasswordLength ? $"Use at most {MaxPasswordLength} characters." : null;
    }

    [GeneratedRegex("^[A-Za-z0-9][A-Za-z0-9._-]{2,31}$", RegexOptions.CultureInvariant)]
    private static partial Regex UsernamePattern();
}
