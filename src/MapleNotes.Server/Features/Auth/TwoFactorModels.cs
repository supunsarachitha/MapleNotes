namespace MapleNotes.Server.Features.Auth;

/// <summary>Whether the signed-in account uses two-factor sign-in.</summary>
/// <param name="Enabled">Whether signing in needs a code from an authenticator app.</param>
/// <param name="RecoveryCodesLeft">How many unused recovery codes the account has; 0 while two-factor sign-in is off.</param>
public sealed record TwoFactorStatusResponse(bool Enabled, int RecoveryCodesLeft);

/// <summary>A new authenticator secret to add to an app. Nothing is saved until it is confirmed with a code.</summary>
/// <param name="Secret">The secret in Base32, for typing into the app.</param>
/// <param name="Uri">The <c>otpauth://</c> link with the secret, account and app name, shown as a QR code.</param>
public sealed record TwoFactorSetupResponse(string Secret, string Uri);

/// <summary>Request to turn on two-factor sign-in.</summary>
/// <param name="Proof">Proof of the account password.</param>
/// <param name="Secret">The secret from <c>POST /api/v1/account/two-factor/setup</c>, as added to the app.</param>
/// <param name="Code">A current code from the app, which shows that it was added correctly.</param>
public sealed record EnableTwoFactorRequest(CredentialProof Proof, string Secret, string Code);

/// <summary>Proof of both factors, for turning two-factor sign-in off or replacing the recovery codes.</summary>
/// <param name="Proof">Proof of the account password.</param>
/// <param name="Code">A current authenticator code, or an unused recovery code.</param>
public sealed record TwoFactorConfirmation(CredentialProof Proof, string Code);

/// <summary>New recovery codes, shown once.</summary>
/// <param name="Codes">The codes; each works once in place of an authenticator code. The server keeps only hashes.</param>
public sealed record RecoveryCodesResponse(IReadOnlyList<string> Codes);
