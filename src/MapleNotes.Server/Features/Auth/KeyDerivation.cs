using System.Diagnostics.CodeAnalysis;

namespace MapleNotes.Server.Features.Auth;

/// <summary>
/// Rules for the Argon2id parameters that browsers use to derive an account's keys from its password
/// (docs/e2ee-spec.md §1).
/// </summary>
/// <remarks>
/// The server never runs Argon2id. It stores each account's parameters, hands them out at prelogin, and refuses
/// parameters weak enough to make guessing the password from a stolen credential hash cheap. The web app enforces
/// the same limits on what it receives (<c>src/maple-web/src/crypto/argon2.ts</c>).
/// </remarks>
public static class KeyDerivation
{
    /// <summary>Salt length in bytes.</summary>
    public const int SaltBytes = 16;

    /// <summary>Length of the authentication key in bytes.</summary>
    public const int AuthKeyBytes = 32;

    /// <summary>Default memory: 64 MiB.</summary>
    public const int DefaultMemoryKiB = 65_536;

    /// <summary>Default passes.</summary>
    public const int DefaultIterations = 3;

    /// <summary>Default lanes.</summary>
    public const int DefaultParallelism = 1;

    /// <summary>Minimum memory: 19 MiB, OWASP's baseline for Argon2id.</summary>
    public const int MinMemoryKiB = 19_456;

    /// <summary>Maximum memory: 1 GiB, beyond what a phone browser can allocate.</summary>
    public const int MaxMemoryKiB = 1_048_576;

    /// <summary>Minimum passes.</summary>
    public const int MinIterations = 2;

    /// <summary>Maximum passes.</summary>
    public const int MaxIterations = 10;

    /// <summary>Maximum lanes.</summary>
    public const int MaxParallelism = 4;

    /// <summary>Checks parameters sent by a browser.</summary>
    /// <param name="kdf">The parameters.</param>
    /// <returns>An error message, or null when they are acceptable.</returns>
    public static string? Validate(KdfParameters? kdf)
    {
        if (kdf is null)
        {
            return "Key-derivation parameters are required.";
        }

        if (kdf.Salt is not { Length: SaltBytes })
        {
            return $"The salt must be {SaltBytes} bytes.";
        }

        return kdf.MemoryKiB is < MinMemoryKiB or > MaxMemoryKiB
            || kdf.Iterations is < MinIterations or > MaxIterations
            || kdf.Parallelism is < 1 or > MaxParallelism
            ? "The key-derivation parameters are outside the accepted range."
            : null;
    }

    /// <summary>Returns true when <paramref name="authKey"/> has the length of an authentication key.</summary>
    /// <param name="authKey">The decoded key.</param>
    /// <returns>Whether it is exactly <see cref="AuthKeyBytes"/> long.</returns>
    public static bool IsAuthKey([NotNullWhen(true)] byte[]? authKey) => authKey is { Length: AuthKeyBytes };
}
