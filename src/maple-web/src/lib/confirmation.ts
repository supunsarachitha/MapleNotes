// Step-up confirmation. The server refuses exports, administrators' changes, passkey changes, turning off two-factor
// sign-in and new recovery codes with 403 `confirmation_required` unless this session signed in or confirmed in the
// last ten minutes. The API client (lib/api.ts) then asks the person through the prompt registered here
// (components/ConfirmIdentityDialog.tsx) and, once they have confirmed, repeats the request.

/** Shows the prompt; resolves true once the session is confirmed, false when the person cancels. */
export type Confirmer = () => Promise<boolean>;

let confirmer: Confirmer | null = null;
let pending: Promise<boolean> | null = null;

/** Registers the prompt (or removes it, with null). Without one, refused requests fail as they are. */
export function setConfirmer(next: Confirmer | null): void {
  confirmer = next;
}

/**
 * Asks the person to confirm it is them. Requests refused at the same time share one prompt, so a page that loads
 * several protected things at once does not stack dialogs.
 */
export function askToConfirm(): Promise<boolean> {
  if (!confirmer) return Promise.resolve(false);
  pending ??= confirmer()
    .catch(() => false)
    .finally(() => {
      pending = null;
    });
  return pending;
}
