# Maple Notes: development plan

Approved 2026-09-28. This is the working plan for v1.0.0; all phases are complete. The architecture reference
is [architecture.md](architecture.md).

## Decisions

| # | Topic | Decision |
|---|---|---|
| 1 | Frontend | React + TypeScript + Vite, served as static files by ASP.NET Core |
| 2 | License | PolyForm Noncommercial 1.0.0; README describes the project as "source-available" |
| 3 | Extras | Markdown rendering, `#tags` with a tag filter, pin-to-top are in v1 |
| 4 | Search | Basic search that decrypts a user's notes in memory |
| 5 | Check-ins | Pause after Phase 0 to report SQLCipher results, then build straight through |
| 6 | Database encryption library (Phase 0) | SQLite3 Multiple Ciphers (MIT) in SQLCipher v4 mode. `SQLitePCLRaw.bundle_e_sqlcipher` is discontinued (last release 2.1.11, SQLite 3.39.2 from 2022, marked "unofficial and unsupported"). Files remain readable by the official `sqlcipher` tool. |
| 7 | Brand colour | Deep maple red `#8f1d21` for the icon, browser theme colour and app accent |
| 8 | Licensing | Third-party license policy and automated check: [licensing.md](licensing.md) |

## Architecture

- **Runtime:** .NET 10 LTS, ASP.NET Core controllers, built-in OpenAPI with XML docs.
- **Data:** EF Core 10 + SQLite, whole-file encrypted in SQLCipher v4 format by SQLite3 Multiple Ciphers (always on).
- **Auth:** cookie authentication, `PasswordHasher` (PBKDF2-HMAC-SHA512, 210k iterations), antiforgery,
  login rate limiting, lockout, security-stamp session revocation.
- **Frontend:** React, TypeScript, Vite, Tailwind CSS, TanStack Query, Radix UI primitives, react-markdown.
- **Deployment:** one container, non-root, port 8080, `/app/data` volume.

### Encryption

| Layer | Covers | Controlled by | Mechanism |
|---|---|---|---|
| Database file | All of `maple.db` | Instance (always on) | SQLCipher v4 format, raw 256-bit key derived from the master key |
| Per-user content | Note bodies and attachment files | User toggle in Settings | AES-256-GCM with a per-user data key |

- `MAPLE_MASTER_KEY` (or `MAPLE_MASTER_KEY_FILE`) is the root secret. It is never written to the volume.
- HKDF-SHA256 derives the SQLCipher key, a key-encryption key (KEK) and the Data Protection key-ring
  wrapping key.
- Each user has a random 256-bit data key (DEK), stored wrapped by the KEK.
- Notes use AES-256-GCM with a versioned header and associated data binding the ciphertext to the
  note and user IDs.
- Attachments use chunked AES-256-GCM (64 KiB segments, counter nonces, final-segment flag), giving
  constant-memory streaming, tamper and truncation detection, and HTTP Range support.
- Toggling encryption requires password re-entry. A background worker migrates existing data; each row
  and file carries its own `IsEncrypted` flag so partial progress is always readable.
- Deleting an account destroys the user's DEK (crypto-shredding).
- This is encryption at rest with server-held keys, not end-to-end encryption. Losing the master key
  loses all data.

### Export

Formats `md`, `txt`, `json`; layouts flat, `YYYY/`, `YYYY-MM/`, `YYYY-MM-DD/`; options for archived
notes, date range and attachments. The ZIP streams straight to the response, attachments go in
`/attachments`, links are rewritten relative to each note's folder, and a `manifest.json` describes
the export. Decrypted content never touches disk.

## Phases

Status is updated as each phase finishes. ✅ done · 🚧 in progress · ⏳ not started

| # | Phase | Done when | Status |
|---|---|---|---|
| 0 | Foundation and SQLCipher spike | `docker compose up` serves the app and `/healthz`; DB file unreadable without the key | ✅ Done (`3a46add`) |
| 1 | Persistence and crypto core | Crypto tests pass: round-trip, wrong key, tampering, truncation, reordering, empty and large files | ✅ Done (`4690bdb`) |
| 2 | Authentication and users | Integration tests pass, including cross-user access denial | ✅ Done (`4690bdb`) |
| 3 | Notes and attachments API | Integration tests pass; OpenAPI docs render | ✅ Done (`ae9cab5`) |
| 4 | Frontend | Full CRUD and attachments work at 375 px and on desktop; Vitest tests pass | ✅ Done (`187a7a0`) |
| 5 | Encryption toggle and migration | Tests cover mixed data and a simulated crash mid-migration | ✅ Done (`a6d19b3`) |
| 6 | Export | Tests verify ZIP structure, decrypted content and links for every format and layout | ✅ Done (`f079dff`) |
| 7 | Hardening, docs and release | From a clean clone: `compose up`, register, post, export all work end to end | ✅ Done (`d74ecb2`) |

Phases 1 and 2 share one commit because the application wiring in `Program.cs` spans both.

Release verification (2026-09-28): a fresh clone of `d74ecb2`, started with `docker compose up -d --build` as the
README describes, passed an 18-step browser run covering the desktop, dark mode and 375 px phone layouts. The run
covered:
- setup and sign-in;
- posting, attachments, pinning, tags, search, editing, archiving, deleting and infinite scroll;
- switching encryption off and on;
- a real export download, whose notes, relative links and attachment bytes were checked independently.

No browser console errors, CSP violations or server errors were recorded.

## Out of scope for v1

Public or shared notes, API tokens, SSO/OAuth, S3 storage, thumbnails, PWA/offline, comments and
reactions, key-rotation UI (the ciphertext format already supports rotation), full-text index.
