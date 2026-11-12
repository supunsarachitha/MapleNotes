using MapleNotes.Server.Features.Passkeys;

namespace MapleNotes.Server.Features.Auth;

/// <summary>A step-up confirmation: exactly one of the password, an authenticator code, or a passkey's answer.</summary>
/// <param name="Proof">Proof of the password, built like the one sent at sign-in.</param>
/// <param name="Code">A code from the authenticator app, or a recovery code (only when two-factor sign-in is on).</param>
/// <param name="ChallengeId">The handle from <c>POST /api/v1/auth/confirm/passkey-options</c>, with <paramref name="Passkey"/>.</param>
/// <param name="Passkey">The answer of one of the account's passkeys, made with user verification.</param>
public sealed record ConfirmRequest(
    CredentialProof? Proof = null, string? Code = null, string? ChallengeId = null, PasskeyAssertion? Passkey = null);

/// <summary>Until when this session counts as recently confirmed.</summary>
/// <param name="ConfirmedUntilUtc">The end of the window, or null when the session has no confirmation that still counts.</param>
public sealed record ConfirmationResponse(DateTime? ConfirmedUntilUtc);
