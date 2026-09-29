# Maple Notes: end-to-end encryption plan (v1.1.0)

Approved 2026-09-29. This plan adds end-to-end encryption (E2EE) as an opt-in mode per account. The v1.0.0 plan is
[PLAN.md](PLAN.md). The byte-level specification is [e2ee-spec.md](e2ee-spec.md), written in phase E0.

## Decisions

Approved by the product owner:

| # | Topic | Decision |
|---|---|---|
| 1 | Scope | Opt-in per account: a third encryption mode, **End-to-end**, next to *Off* and *Encrypted at rest*. Users can switch in both directions. |
| 2 | Password | One password for sign-in and encryption. The browser derives two independent keys from it: an authentication key (sent to the server) and a wrapping key (never leaves the browser). |
| 3 | Trade-offs | Without the recovery key, a forgotten password means the notes are lost. Search, tags, export and attachment decryption run in the browser. |

Derived from the approved decisions:

| # | Topic | Decision | Why |
|---|---|---|---|
| 4 | Sign-in for everyone | All accounts move to key-derived sign-in; existing accounts upgrade at their next sign-in. | Otherwise the sign-in step would reveal which usernames use E2EE, and the server would still receive passwords. |
| 5 | Password derivation | Argon2id (RFC 9106), 64 MiB, 3 passes, run in a Web Worker via `hash-wasm` (MIT). | Memory-hard, so offline guessing is expensive. The worker keeps the page responsive. |
| 6 | Tags | Keyed "blind" tag tokens (HMAC-SHA256) plus encrypted tag names. | The server can filter and count tags without learning their names. |
| 7 | Media | A service worker decrypts attachments on the fly, including byte ranges, so video seeking works. It falls back to in-memory decryption when service workers are unavailable. | No full download before playback. |
| 8 | Export | Built in the browser with `fflate` (MIT) and streamed to disk through the service worker, with the same structure as the server export. | The server cannot decrypt the notes. |
| 9 | Version | Ships as **v1.1.0**. The database encryption and master key stay as a second layer that protects metadata. | Opt-in feature; existing data keeps working. |

## Design summary

### Keys

```text
password ──Argon2id(salt, 64 MiB, t=3)──► master secret (browser only)
                                           ├─HKDF "auth"──► authentication key ──► server (stored only as a PBKDF2 hash)
                                           └─HKDF "wrap"──► wrapping key ──► wraps the E2EE data key (AES-256-GCM)
E2EE data key (random, created in the browser)
   ├─HKDF "note"─────────► note text (AES-256-GCM, bound to user and note IDs)
   ├─HKDF "metadata"─────► attachment names/types and tag names
   ├─HKDF "tag-index"────► tag tokens (HMAC-SHA256)
   └─HKDF(file salt)─────► attachment files (chunked AES-256-GCM, same format as today)
recovery key (random, shown once) ──HKDF──► recovery wrapping key + recovery authentication key
```

The server stores the data key only in wrapped form: once under the password-derived key and once under the recovery
key. It can never unwrap it.

### What the server can and cannot see for an end-to-end account

| Can see | Cannot see |
|---|---|
| When notes were created and edited, their sizes and how many there are | Note text |
| Pinned and archived flags | Tag names (it sees opaque tokens, and which notes share one) |
| Attachment sizes and upload times | Attachment contents, file names and types |
| Sign-in times and IP addresses | The password or any key that decrypts content |

A web app's code is delivered by its server, so a compromised server could deliver malicious code. This limit is
inherent to browser-based E2EE and will be documented. The strict Content-Security-Policy, the lack of third-party
scripts and published build hashes reduce the risk.

### Modes and transitions

| From → To | Who converts existing content |
|---|---|
| Off ↔ Encrypted at rest | The server (existing background worker) |
| Off / at rest → End-to-end | The browser: it fetches the remaining readable items, encrypts them with the new data key and uploads them. It is resumable after a reload or crash. At the end, the server destroys its own key for the account. |
| End-to-end → Off / at rest | The browser: it decrypts each item and hands it back to the server, which applies the new mode. At the end, the server deletes the E2EE key material. |

Every note and attachment records its own scheme (`None`, `Server`, `EndToEnd`), so mixed content during a transition
always stays readable.

## Phases

Status is updated as each phase finishes. ✅ done · 🚧 in progress · ⏳ not started

| # | Phase | Done when | Status |
|---|---|---|---|
| E0 | Crypto specification and shared test vectors | `docs/e2ee-spec.md` written; TypeScript and C# implementations produce identical results for the committed test vectors | ✅ Done (`bfdaaf4`) |
| E1 | Key-derived sign-in for every account | The server never receives a password (register, sign-in, password change, re-authentication); legacy accounts upgrade at sign-in; unknown usernames are indistinguishable; all existing tests pass on the new flow | ✅ Done (`d819094`) |
| E2 | End-to-end mode and key management | Three encryption modes and per-item schemes; recovery kit, password-reset-by-recovery-key and unlock screen; the server enforces ciphertext-only writes for E2EE accounts | ✅ Done (`f117e43`) |
| E3 | Notes, tags and search in the browser | For an E2EE account the database contains no note text or tag names (asserted by scanning); tag filter and search work in the browser | ✅ Done (`f521023`) |
| E4 | Attachments and the media service worker | Files and their names are stored only as ciphertext; images and video (with seeking) play through the service worker; fallback without it | ✅ Done |
| E5 | Switching modes in both directions | Resumable browser-driven conversion with progress; tests interrupt it in both directions; the server holds no content key after entering E2EE | ⏳ Not started |
| E6 | Export in the browser | The browser export matches the server export's structure for all 12 format and layout combinations; streamed download verified | ⏳ Not started |
| E7 | Hardening, documentation and release | CSP updated for the worker and WebAssembly; threat model documented; README, architecture, CHANGELOG (v1.1.0), licensing and notices updated; clean-clone browser run passes | ⏳ Not started |

### Notes from the phases

- **E1:** unknown usernames are indistinguishable from real accounts at prelogin and sign-in. The one exception is an
  account created by 1.0.0 that has not signed in since the upgrade: prelogin answers `upgrade: true` for it until
  its next sign-in (documented in the spec). The Content-Security-Policy change for the Argon2id worker and
  WebAssembly (`worker-src 'self'`, `'wasm-unsafe-eval'`) was needed for sign-in to work, so it moved forward from E7;
  E7 still reviews the final policy. Verified in Chromium: the 18-step browser suite on a fresh instance, and the
  one-time upgrade on a copy of 1.0.0 data.
- **E2:** the unlocked key is kept in IndexedDB sealed under a per-session secret carried in the HttpOnly session
  cookie (spec §7), so a saved copy is useless once the session ends. The Settings switch into end-to-end mode arrives
  with the conversion of existing content in E5; until then the app stays fully usable for every account. Verified in
  Chromium through the Vite dev server (the page imports the app's own `e2ee` module to switch an account): setup,
  saved-key restore after a reload, the unlock screen on a second browser, reset with the recovery key (which signs
  out other devices), sign-in with the new password, and a new recovery key from Settings.
- **E3:** a server test reads every value of every table of the decrypted database and finds no note text or tag
  names (with a positive control proving the scan reads stored values). While designing the browser check, one leak
  was found and closed: tag filters sent the tag's name alongside its tokens; the name is now sent only while
  plain-text notes still carry that tag. Verified in Chromium: posting, editing and pinning encrypted notes, decrypted
  tag names, a nested tag filter, search, and a reload, with none of the 28 requests carrying note text or tag names;
  the 18-step suite still passes for ordinary accounts.
- **E4:** the service worker is registered only for accounts with an end-to-end key and handles only `/e2ee/…`, so
  other accounts are unaffected; the server answers `/e2ee/…` with 404 rather than the app's page. It ships as a
  classic script (`/sw.js`, a second Vite build) for broad browser support; in development Vite serves it as a module.
  Verified in Chromium: an image, a 30-second 7.5 MB video seeking to 25 s (the worker fetched only byte ranges,
  including ranges deep into the file), a decrypted named download, and the same files with service workers blocked
  (decrypted in the page); the built `/sw.js` in the container; the three stored files start with the `MNAE` header
  and contain no plaintext markers.

## Out of scope for v1.1.0

Sharing encrypted notes between accounts, native or extension clients that verify the app's code, key rotation
without the password, offline use, and end-to-end encryption of instance or administrator data.
