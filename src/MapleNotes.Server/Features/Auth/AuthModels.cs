using MapleNotes.Server.Domain;

namespace MapleNotes.Server.Features.Auth;

/// <summary>Request to create an account.</summary>
/// <param name="Username">Login name: 3–32 letters, digits, dots, dashes or underscores.</param>
/// <param name="Password">At least 10 characters.</param>
/// <param name="DisplayName">Name shown in the interface; defaults to the username.</param>
public sealed record RegisterRequest(string Username, string Password, string? DisplayName = null);

/// <summary>Request to sign in.</summary>
/// <param name="Username">Login name (case-insensitive).</param>
/// <param name="Password">Password.</param>
/// <param name="RememberMe">Keep the session for 30 days instead of until the browser closes.</param>
public sealed record LoginRequest(string Username, string Password, bool RememberMe = false);

/// <summary>Request to change the signed-in user's password.</summary>
/// <param name="CurrentPassword">The current password, to confirm it is really the account owner.</param>
/// <param name="NewPassword">The new password (at least 10 characters).</param>
public sealed record ChangePasswordRequest(string CurrentPassword, string NewPassword);

/// <summary>A user account as returned by the API.</summary>
/// <param name="Id">Account ID.</param>
/// <param name="Username">Login name.</param>
/// <param name="DisplayName">Name shown in the interface.</param>
/// <param name="Role">Account role.</param>
/// <param name="EncryptionEnabled">Whether the account's notes and attachments are encrypted at rest.</param>
/// <param name="CreatedAtUtc">When the account was created.</param>
public sealed record UserResponse(
    Guid Id, string Username, string DisplayName, UserRole Role, bool EncryptionEnabled, DateTime CreatedAtUtc)
{
    /// <summary>Maps an account entity to its API representation.</summary>
    /// <param name="user">The account.</param>
    /// <returns>The API representation.</returns>
    public static UserResponse From(User user) =>
        new(user.Id, user.Username, user.DisplayName, user.Role, user.EncryptionEnabled, user.CreatedAtUtc);
}

/// <summary>Sign-in state of the current visitor and what the instance allows.</summary>
/// <param name="SetupRequired">True when no account exists yet; the first account becomes the administrator.</param>
/// <param name="RegistrationOpen">Whether visitors can create accounts.</param>
/// <param name="User">The signed-in user, or null.</param>
public sealed record AuthStatusResponse(bool SetupRequired, bool RegistrationOpen, UserResponse? User);

/// <summary>An antiforgery token to send with every state-changing request.</summary>
/// <param name="Token">Token value.</param>
/// <param name="HeaderName">Header to send it in.</param>
public sealed record AntiforgeryTokenResponse(string Token, string HeaderName);
