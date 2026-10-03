using MapleNotes.Server.Domain;

namespace MapleNotes.Server.Features.Auth;

/// <summary>
/// Argon2id parameters for deriving an account's keys from its password in the browser (docs/e2ee-spec.md §1).
/// </summary>
/// <param name="Salt">16 random bytes per account (base64 in JSON).</param>
/// <param name="MemoryKiB">Memory in KiB: 19,456–1,048,576; the web app uses 65,536.</param>
/// <param name="Iterations">Passes: 2–10; the web app uses 3.</param>
/// <param name="Parallelism">Lanes: 1–4; the web app uses 1.</param>
public sealed record KdfParameters(byte[] Salt, int MemoryKiB, int Iterations, int Parallelism);

/// <summary>Request for the key-derivation parameters of an account.</summary>
/// <param name="Username">Login name (case-insensitive).</param>
public sealed record PreloginRequest(string Username);

/// <summary>What the browser needs before it can derive the keys to sign in.</summary>
/// <param name="Kdf">
/// The account's key-derivation parameters. For an unknown username these are the defaults with a deterministic
/// pseudo-salt, so the answer does not reveal whether the account exists.
/// </param>
/// <param name="Upgrade">
/// True for an account created before version 1.1, which still holds a hash of the password: the next sign-in or
/// password confirmation must also send the password once, so the server can switch the account to key-derived
/// sign-in.
/// </param>
public sealed record PreloginResponse(KdfParameters Kdf, bool Upgrade);

/// <summary>Request to create an account. The password itself never leaves the browser.</summary>
/// <param name="Username">Login name: 3–32 letters, digits, dots, dashes or underscores.</param>
/// <param name="Kdf">The parameters the browser used, with a new random salt.</param>
/// <param name="AuthKey">The 32-byte authentication key derived from the password (base64).</param>
/// <param name="DisplayName">Name shown in the interface; defaults to the username.</param>
public sealed record RegisterRequest(string Username, KdfParameters Kdf, byte[] AuthKey, string? DisplayName = null);

/// <summary>Request to sign in.</summary>
/// <param name="Username">Login name (case-insensitive).</param>
/// <param name="AuthKey">The 32-byte authentication key derived with the parameters from prelogin (base64).</param>
/// <param name="RememberMe">Keep the session for 30 days instead of until the browser closes.</param>
/// <param name="Password">
/// Only when prelogin answered <c>upgrade: true</c>: the password, sent this one time so the server can check it
/// against the old hash and replace that hash with one of <paramref name="AuthKey"/>. Ignored for every other account.
/// </param>
public sealed record LoginRequest(string Username, byte[] AuthKey, bool RememberMe = false, string? Password = null);

/// <summary>Proof that the caller knows the account password, required for security-relevant changes.</summary>
/// <param name="AuthKey">The authentication key derived with the parameters from prelogin (base64).</param>
/// <param name="Password">Only when prelogin answered <c>upgrade: true</c>; see <see cref="LoginRequest"/>.</param>
public sealed record CredentialProof(byte[] AuthKey, string? Password = null);

/// <summary>Request to change the signed-in user's password.</summary>
/// <param name="Current">Proof of the current password.</param>
/// <param name="NewKdf">Parameters for the new password, with a new random salt.</param>
/// <param name="NewAuthKey">The authentication key derived from the new password (base64).</param>
/// <param name="NewWrappedKey">
/// For an account with an end-to-end key, required: the same data key wrapped with the new password's wrapping key.
/// Must be omitted otherwise.
/// </param>
public sealed record ChangePasswordRequest(
    CredentialProof Current, KdfParameters NewKdf, byte[] NewAuthKey, byte[]? NewWrappedKey = null);

/// <summary>A user account as returned by the API.</summary>
/// <param name="Id">Account ID.</param>
/// <param name="Username">Login name.</param>
/// <param name="DisplayName">Name shown in the interface.</param>
/// <param name="Role">Account role.</param>
/// <param name="EncryptionMode">How the account's new notes and attachments are protected.</param>
/// <param name="HasEndToEndKey">
/// Whether the account has an end-to-end key: the browser then needs it unlocked to read (and, in end-to-end mode,
/// to write) content.
/// </param>
/// <param name="CreatedAtUtc">When the account was created.</param>
/// <param name="Preferences">Writing and feature preferences.</param>
/// <param name="EndToEndModeRecord">For an account with an end-to-end key, the mode its owner chose, sealed by the
/// browser (docs/e2ee-spec.md §3a); the server cannot read or forge it.</param>
public sealed record UserResponse(
    Guid Id, string Username, string DisplayName, UserRole Role, EncryptionMode EncryptionMode, bool HasEndToEndKey,
    DateTime CreatedAtUtc, UserPreferences Preferences, byte[]? EndToEndModeRecord = null)
{
    /// <summary>Maps an account entity to its API representation.</summary>
    /// <param name="user">The account.</param>
    /// <returns>The API representation.</returns>
    public static UserResponse From(User user) =>
        new(user.Id, user.Username, user.DisplayName, user.Role, user.EncryptionMode, user.E2eeWrappedKey is not null,
            user.CreatedAtUtc, user.Preferences, user.E2eeModeRecord);
}

/// <summary>Sign-in state of the current visitor and what the instance allows.</summary>
/// <param name="SetupRequired">True when no account exists yet; the first account becomes the administrator.</param>
/// <param name="RegistrationOpen">Whether visitors can create accounts.</param>
/// <param name="User">The signed-in user, or null.</param>
/// <param name="LinkPreviewsAvailable">Whether this server allows link previews (<c>MAPLE_LINK_PREVIEWS</c>).</param>
/// <param name="Branding">The app's name and icon.</param>
/// <param name="Version">The server's version (for example 1.6.0), for signed-in users only: visitors are not told
/// which version a server runs.</param>
/// <param name="SessionPersistent">Whether this session was started with "keep me signed in", so it outlives the browser.
/// The web app keeps notes on the device for offline reading only then.</param>
public sealed record AuthStatusResponse(
    bool SetupRequired, bool RegistrationOpen, UserResponse? User, bool LinkPreviewsAvailable = false, BrandingResponse? Branding = null,
    string? Version = null, bool SessionPersistent = false);

/// <summary>How the app presents itself, as administrators set it; shown before anyone signs in.</summary>
/// <param name="AppName">The app's name.</param>
/// <param name="IconUrl">Where its custom icon is, or null for the app's own icon.</param>
public sealed record BrandingResponse(string AppName, string? IconUrl);

/// <summary>An antiforgery token to send with every state-changing request.</summary>
/// <param name="Token">Token value.</param>
/// <param name="HeaderName">Header to send it in.</param>
public sealed record AntiforgeryTokenResponse(string Token, string HeaderName);
