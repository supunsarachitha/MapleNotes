namespace MapleNotes.Server.Infrastructure.Web;

/// <summary>Names of the rate-limiting policies.</summary>
public static class RateLimitPolicies
{
    /// <summary>
    /// Limits sign-in, registration and password-confirmation attempts per client IP address per minute
    /// (<c>MAPLE_AUTH_RATE_LIMIT</c>, default 10), slowing down password guessing.
    /// </summary>
    public const string Authentication = "authentication";

    /// <summary>
    /// Limits prelogin requests per client IP address per minute, with the same limit as
    /// <see cref="Authentication"/> but a separate budget, since every sign-in makes one of each.
    /// </summary>
    public const string Prelogin = "prelogin";
}
