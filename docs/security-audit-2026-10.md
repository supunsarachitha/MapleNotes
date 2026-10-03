# Security audit, October 2026

A review of the whole application at version 1.10.1 (commit `54d6e28`): the server, the web app, the service worker,
the encryption, the deployment files and the dependencies. It was read against [threat-model.md](threat-model.md) and
[e2ee-spec.md](e2ee-spec.md): a finding is something that breaks a promise those documents make, or that the code makes
possible without them saying so.

Findings were confirmed by reading the code paths end to end and, where it mattered, by a failing test or a probe
against the running app. Each fix on this branch comes with a test that fails without it.

## Summary

| Severity | Found | Fixed here | Open |
|---|---|---|---|
| Critical | 1 | 1 | 0 |
| High | 2 | 2 | 0 |
| Medium | 9 | 5 | 4 |
| Low | 19 | 9 | 10 |

No finding lets one account read, change or delete another account's data: every endpoint requires sign-in, and every
query is scoped to the caller. No finding gives script execution in the app (no XSS), and the link-preview fetcher
cannot be pointed at internal addresses. `dotnet list package --vulnerable` and `npm audit` report nothing.

The critical finding and one of the high ones share a cause: **the browser trusted flags the server
sends** about the account's encryption mode and sign-in method. End-to-end mode promises to hold against "a server
that is compromised but serves the genuine app", and that server controls those flags.

## Fixed on this branch

| # | Severity | Finding | Fix |
|---|---|---|---|
| 0 | Critical | **The server could move an end-to-end account out of end-to-end encryption.** Which way the browser converted content, and whether it encrypted new content, was decided by the mode the server reported. A server answering `mode: "AtRest"` made every unlocked browser decrypt all notes, files and label names and send them back in plaintext, without a prompt, and send later edits in plaintext. (`conversion.ts`, `noteCrypto.ts`, `App.tsx`) | The owner's choice of mode is sealed with the end-to-end key (a "mode record", [e2ee-spec.md §3a](e2ee-spec.md#3a-the-mode-record)) whenever it changes; browsers decrypt and send plaintext only when the record confirms the server's mode, refuse records older than one they have seen, and otherwise keep encrypting and warn in Settings. A browser that last saw the account end-to-end stops and asks if the server says the key is gone. |
| 1 | High | **Link-preview parser CPU exhaustion.** A previewed page with one large `<meta>` tag made the attribute regex backtrack quadratically: 64 KB took 89 s, 512 KB minutes of a core per request. Any signed-in user with previews on could pin every core. (`LinkPreviewParser.cs`) | Parse only the page's head, at most 64 KB; skip meta tags over 4 KB; run every pattern on the non-backtracking engine. |
| 2 | High | **The server could ask for the password.** When prelogin answered `upgrade: true`, the browser sent the plaintext password with every sign-in and every password confirmation. With it, a server derives the wrapping key and opens the end-to-end key. (`credentials.ts`) | The password is sent only at sign-in, the one moment a 1.0 account upgrades, and never for an account this browser has already signed in to with a derived key. |
| 3 | Medium | **Concurrent sign-ins bypassed the lockout.** Failed attempts were counted with read-increment-save, so overlapping attempts overwrote each other: 40 at once left the count at 3. (`AccountService.cs`) | One atomic `UPDATE … SET AccessFailedCount = AccessFailedCount + 1`, then lock. |
| 4 | Medium | **Conversions bypassed the storage limit.** Converting a note to or from end-to-end encryption is not counted against the limit, and accepted any envelope up to 400 KB: a 1 MB account stored 3 MB in a test. (`ConversionService.cs`) | A conversion may not be larger than the note: an envelope is exactly the text's UTF-8 bytes plus 30. |
| 5 | Medium | **Truncated files in the service worker.** A server answering a range with fewer chunks than asked made the worker serve the file with pieces silently missing; each chunk that did arrive was authentic. (`sw/media.ts`) | Every range response must have exactly the requested length. |
| 6 | Medium | **Link-preview rate limit was per address, not per account.** The rate limiter ran before authentication, so the "per user" policy always fell back to the client address. (`Program.cs`) | The limiter runs after authentication. |
| 7 | Medium | **IPv6 clients got a budget per address.** Anyone with a /64 (any VPS) had 2^64 budgets for sign-in attempts. | Per-address limits count IPv6 clients by /64. |
| 8 | Low | **Unbounded, shared link-preview cache.** Keyed by the full URL including `#fragment` (each a new entry and fetch), with no size limit, and shared by all accounts, so response times told one account which links another had previewed. | Cached per account, without the fragment, at most 10,000 entries. |
| 9 | Low | **An admin could set an undefined role** (JSON accepts `"role": 7`), demoting themselves past the self-demotion check and possibly leaving no administrator. | Unknown roles are refused; any non-admin role on oneself counts as a demotion. |
| 10 | Low | **The trash purge could delete a note restored meanwhile**: it re-selected the batch by ID only. | The purge rechecks the trash condition. |
| 11 | Low | **Decrypted attachments stayed in the browser's disk cache for a year** (`immutable`), readable after sign-out, after deleting the file, and after converting to end-to-end. | Decrypted files are `no-store`. End-to-end files, served as ciphertext, are still cached. |
| 12 | Low | **Protocol-relative links** (`[x](//phish.example)`) in a note were treated as app pages: a plain click did nothing, but opening in a new tab went to the other site. | Only real paths are app links; `//host` opens as an external link. |
| 13 | Low | **Markdown images could trigger heavy or tracking requests**: `![](/api/v1/export)` streamed a full export every time the note was shown. | Only the account's own attachment URLs render as images; others show their alt text. |
| 14 | Low | **Restoring a hostile backup could exhaust memory**: an entry declaring 2 GB in a few KB was allocated up front. | Entries claiming more than their compressed data can hold are refused, and note and manifest files are capped. |
| 15 | Low | **Upload names could hide their extension** with right-to-left override characters (`invoice‮fdp.exe` shows as `invoiceexe.pdf`). | Text-reordering characters and line separators are stripped; emoji joiners stay. |
| 16 | Low | **Old page copies outlived `secure_delete`** in the write-ahead log (`maple.db-wal`). | `journal_size_limit = 0` truncates the log after each checkpoint. |

Note on #11: plain images are now fetched again when a page is reloaded, instead of coming from the disk cache.

## Open findings

The critical finding is fixed above. What remains of it: a browser that has never seen the account (a new device,
cleared storage) cannot tell a server that claims the account has no end-to-end key from one where the owner left
end-to-end encryption, since the record's key is what is missing.

### Medium

| Finding | Where | Recommendation |
|---|---|---|
| **End-to-end tag names and file metadata are not counted against the storage limit.** A note counted as 31 bytes carried 9 KB of encrypted tag names. | `StorageService.GetUsageAsync`, `NoteService.SetEncryptedTagsAsync` | Count tag `EncryptedName` and attachment `EncryptedMetadata` bytes and a fixed cost per row; claim new tag bytes on create, update and import. |
| **In "Off" mode, attachments are plaintext on the data volume**, while architecture.md and threat-model.md say files are ciphertext in all modes. Someone with a disk copy but no master key reads them. | `AttachmentService.cs` | Encrypt Off-mode files with an instance key derived from the master key, or correct the documents. |
| **`portainer-stack-npm.yml` trusts `172.16.0.0/12` and publishes port 8088 on all interfaces.** A client reaching 8088 directly from such a network (many LANs, or through Docker's userland proxy) can send its own `X-Forwarded-For` and get a new rate-limit budget per request. | `deploy/portainer-stack-npm.yml` | Put the app on NPM's Docker network with `expose` (as the Caddy stack does) and trust only that network, or bind the port to the address NPM uses. |
| **Usernames can be confirmed through the lockout**: five wrong sign-ins give 429 for a real account and 401 forever for an unknown one (and lock the real user out). | `AccountService.ValidateCredentialsAsync` | Count failures for unknown names too (in memory), or never reveal the lockout and answer 401. |

### Low

- **Signing out does not end the session on the server.** A copied cookie keeps working after "Sign out" (sliding 30
  days); only "Sign out everywhere" and password changes revoke. Add a session ID and revoke it on sign-out, and an
  absolute session lifetime.
- **Another account's note, file or label ID can be confirmed** by importing or creating with that ID (409, or a
  silently replaced ID). IDs cannot be guessed (74 random bits), so the attacker must already know one. Make IDs unique
  per account, or answer identically whoever holds the ID.
- **The server can show forged plaintext items in an end-to-end account** (a note without ciphertext is shown as is).
  Mark or refuse plaintext items while the account is end-to-end and no conversion runs.
- **The server can probe end-to-end tag names** by listing candidate names as plain tags; filtering by one sends its
  name. Never send `tag=` names in end-to-end mode.
- **The server chooses the Argon2 parameters and salt** (down to 19 MiB, t = 2, and a shared salt is possible), which
  makes offline guessing from captured sign-in keys cheaper. Remember each account's parameters in the browser and warn
  when they change or weaken.
- **Two admins deleting at the same time can leave no administrator** (and reopen first-user setup). Run the check and
  the delete in one transaction.
- **Password confirmations (change password, delete account, change mode) have no lockout**, only the per-address limit.
  Share the sign-in lockout counter.
- **PBKDF2 on unauthenticated endpoints** costs 100–200 ms each with only per-address limits; a botnet can saturate the
  CPU. Add a global concurrency limit on the authentication policies.
- **Caddy's `on_demand_tls` asks `/healthz`**, which always says yes, so any hostname gets a certificate
  (`portainer-stack-https.yml`). Use an ask endpoint that allows only the expected names.
- **The label limit and the daily-note import can race** (more than 100 labels; a 500 instead of a 409). Owner-only.

## Hardening backlog

- CSP: drop `img-src data:` and `font-src data:` if unused; consider removing `style-src 'unsafe-inline'`.
- HSTS: one year and configurable (the default is 30 days).
- GitHub Actions: pin actions and base images by digest; do not grant `packages: write` to pull-request runs.
- `master.key` is created with `umask 022` in the Portainer stacks; prefer 0440 for the app's group.
- Backups (`data/backups`) keep deleted notes and accounts until rotated out; say so in the threat model.
- Recovery-key endpoints skip the account lockout (recovery keys are 256 random bits, so this is defence in depth).
- Add the remaining special-use ranges (`64:ff9b:1::/48`, `2001::/32`, `192.88.99.0/24`) to `NetworkGuard`.
- Consider a default storage limit.

## Checked and sound

- **Authorization:** a global authorization filter; `[AllowAnonymous]` only on status, antiforgery, prelogin, register,
  login, logout, recovery and the branding icon. Admin routes are role-checked, and roles are re-read from the database
  on every request. Every content query is scoped to the caller; another account's IDs answer 404. Attaching another
  account's file or label is refused like a missing one. No over-posting.
- **Sessions and CSRF:** HttpOnly, SameSite=Strict, Data Protection-encrypted cookies, revalidated on every request
  (user exists, not disabled, security stamp). Antiforgery on every non-GET action; no GET changes state; no CORS.
  First-user-becomes-admin is serialized.
- **Credentials:** PBKDF2-HMAC-SHA512 at 210,000 iterations, constant-time comparison, a dummy check for unknown users,
  256-bit recovery keys, uniform errors.
- **Encryption:** envelope and AAD formats match the spec; 96-bit random nonces; HKDF contexts bind the user and item IDs,
  so the server cannot swap ciphertexts between items. Non-extractable `CryptoKey`s in the browser; the stored copy is
  sealed under a secret held only in the HttpOnly cookie. SQLCipher with an HKDF-derived key; the Data Protection key
  ring is encrypted.
- **Web:** no raw HTML in Markdown; `javascript:`, `vbscript:` and `data:` links are stripped; no `innerHTML` or `eval`.
  A strict CSP, `frame-ancestors 'none'`, `nosniff`, `no-referrer`, COOP and CORP. Only passive types are shown inline;
  attachments carry a sandbox CSP. No open redirects. Export archives cannot escape their folder (no zip-slip).
- **Link previews:** http(s) on default ports only, every address checked again when the socket connects (no DNS
  rebinding), redirects re-checked, 512 KB and 5 s limits, off unless both the server and the account allow it.
- **Hosting:** forwarded headers trusted only from configured proxies; no stack traces in production; no secrets or note
  text in logs; a non-root, chiseled image with a read-only root filesystem and no capabilities.
- **Dependencies:** no known vulnerabilities in NuGet or npm packages.
