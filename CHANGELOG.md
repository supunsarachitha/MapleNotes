# Changelog

All notable changes to Maple Notes are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security

- **Key-derived sign-in:** the password never leaves the browser. It is turned into an authentication key with
  Argon2id (64 MiB, 3 passes, run in a Web Worker) and HKDF, and the server stores only a PBKDF2 hash of that key. This
  is the foundation for end-to-end encryption. Accounts created with 1.0.0 upgrade automatically at their next sign-in.

### Added

- `POST /api/v1/auth/prelogin` returns an account's key-derivation parameters and answers in the same shape for
  unknown usernames. It has its own rate limit.
- **End-to-end key management:** accounts have an encryption mode (off, at rest or end-to-end) and every note and
  attachment its own scheme. The browser creates the end-to-end key and stores it on the server only wrapped by the
  password and by a recovery key. Includes an unlock screen, password reset with the recovery key, a new recovery key
  from Settings, and keeping the unlocked key in the browser sealed under a secret that ends with the session.
- **End-to-end encrypted notes and tags:** in end-to-end mode the browser encrypts each note under an ID it chooses,
  and turns tags into blind tokens with encrypted names; the server filters and counts by token. Search and nested tag
  filters work in the browser, and neither note text, tag names nor search terms reach the server.
- **End-to-end encrypted attachments:** files and their names are encrypted in the browser before upload. A media
  service worker decrypts them on the fly for the page, fetching only the byte ranges it needs, so images appear at
  once and videos seek; without it, the page decrypts whole files.
- `GET /api/v1/attachments/{id}/info` returns an attachment's details without its content.
- **Switching to and from end-to-end encryption** in Settings, now a choice of three modes. Turning it on explains
  what changes, asks for an acknowledgement and shows the recovery key once; existing notes and files are then
  encrypted in the browser, and turning it off decrypts them there. The conversion resumes after a reload, never
  overwrites an edit, keeps note timestamps, and can be reversed midway. Once it finishes, the server deletes the key
  nothing needs any more: an end-to-end account leaves the server with no key to its content.

### Changed

- **API (breaking for third-party clients):** sign-in, registration, password change, the encryption setting and
  account deletion take an authentication key or a `proof` instead of a password; see the OpenAPI document and
  `docs/e2ee-spec.md`. The bundled web app is updated.
- Password rules (at least 10 characters) are checked by the web app, since the server no longer sees passwords.
- **API (breaking for third-party clients):** `GET`/`PUT /api/v1/account/encryption` use `mode` (`Off`, `AtRest`,
  `EndToEnd`) instead of `enabled`, and accounts carry `encryptionMode` and `hasEndToEndKey` instead of
  `encryptionEnabled`.
- The Content-Security-Policy allows WebAssembly compilation (`'wasm-unsafe-eval'`, which does not allow JavaScript
  `eval`) and same-origin workers.
- Attachment URLs carry the stored version (`?v=`), so a file whose stored bytes change gets a new URL while
  downloads stay cacheable.

## [1.0.0] - 2026-09-28

First release.

### Added

- **Notes**
  - Timeline feed with a quick-post composer, pinned notes and cursor-based infinite scroll that stays stable while
    new notes arrive.
  - Create, inline edit, pin, archive and restore, and delete with confirmation.
  - GitHub-flavoured Markdown and clickable `#tags` (including nested tags) with a tag list and tag filter.
  - Search that works on encrypted notes.
- **Attachments**
  - File picker, paste and drag-and-drop uploads with progress; streamed to storage and never buffered whole.
  - Inline images, video and audio; HTTP Range downloads.
  - Configurable size limit (`MAPLE_MAX_UPLOAD_MB`).
  - Hourly cleanup of abandoned uploads and orphan files.
- **Export**
  - ZIP archive of Markdown (with YAML front matter), plain text or JSON.
  - Flat or year, month or day folders by the note's local date; optional date range and archived notes.
  - Decrypted attachments in `attachments/`, linked from notes by relative path, plus a `manifest.json`.
  - Streamed while it is generated.
- **Accounts**
  - The first account becomes the administrator; optional open registration.
  - Password change, "sign out everywhere", and account deletion.
  - Administration of accounts (disable, change role, delete) and instance settings.
- **Web app**
  - Mobile-first responsive layout: navigation drawer on phones, sidebar on wide screens.
  - Light and dark themes, keyboard shortcuts, accessible dialogs and menus, reduced-motion support.
- **Operations**
  - Single multi-architecture Docker image (chiseled, non-root, built-in health check) and a hardened
    `docker-compose.yml`.
  - `generate-key` and online `backup` commands.
  - Automatic database migrations with an encrypted backup first.
  - OpenAPI document with an interactive reference (`MAPLE_API_DOCS`).
- **Documentation**
  - README, architecture guide, third-party notices, and a license policy with an automated dependency license
    check.

### Security

- **Database encryption:** the whole database is always encrypted (SQLCipher v4 format via SQLite3 Multiple
  Ciphers) with a key derived from `MAPLE_MASTER_KEY`, which is never stored in the data volume.
- **Per-account encryption at rest:** each account has its own data key.
  - Note text uses AES-256-GCM; attachments use chunked AES-256-GCM that detects tampering, truncation and
    reordering.
  - The switch in Settings converts existing data in the background, safely across crashes and concurrent edits.
- **Crypto-shredding:** deleting an account destroys its data key; the database runs with `secure_delete`.
- **Session key protection:** the ASP.NET Core Data Protection key ring is encrypted, so a copied volume cannot be
  used to forge sessions.
- **Sign-in:**
  - PBKDF2-HMAC-SHA512 password hashing with 210,000 iterations.
  - Identical responses for unknown users and wrong passwords.
  - Lockout after 5 failures, and per-IP rate limiting.
- **Web protections:**
  - HttpOnly, SameSite=Strict session cookies validated on every request, plus antiforgery tokens.
  - Strict Content-Security-Policy and security headers; HSTS over HTTPS.
  - Trusted-proxy allowlist for forwarded headers.
  - Request body limits.
- **Uploaded files** are served inline only for passive media types, and always with `nosniff` and a sandboxing
  Content-Security-Policy.

[Unreleased]: https://github.com/supunsarachitha/MapleNotes/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/supunsarachitha/MapleNotes/releases/tag/v1.0.0
