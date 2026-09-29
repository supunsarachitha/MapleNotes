using Microsoft.AspNetCore.Identity;

namespace MapleNotes.Server.Features.Auth;

/// <summary>Password hashing parameters.</summary>
/// <remarks>
/// ASP.NET Core Identity's hasher in its version 3 format: PBKDF2 with HMAC-SHA512, a 128-bit random salt and a
/// 256-bit derived key. The iteration count follows the OWASP Password Storage Cheat Sheet recommendation for
/// PBKDF2-HMAC-SHA512 (210,000). The count is stored inside each hash, so it can be raised later; existing hashes are
/// upgraded automatically at the user's next sign-in.
/// </remarks>
public static class PasswordHashing
{
    /// <summary>PBKDF2 iteration count for new hashes.</summary>
    public const int IterationCount = 210_000;

    /// <summary>Hasher options used by the application.</summary>
    public static PasswordHasherOptions Options => new()
    {
        CompatibilityMode = PasswordHasherCompatibilityMode.IdentityV3,
        IterationCount = IterationCount,
    };
}
