namespace MapleNotes.Server.Infrastructure.Web;

/// <summary>Names of the rate-limiting policies.</summary>
public static class RateLimitPolicies
{
    /// <summary>
    /// Limits sign-in, registration and password-change attempts per client IP address per minute
    /// (<c>MAPLE_AUTH_RATE_LIMIT</c>, default 10), slowing down password guessing.
    /// </summary>
    public const string Authentication = "authentication";
}
