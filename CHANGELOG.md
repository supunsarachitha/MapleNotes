# Changelog

All notable changes to Maple Notes are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Work toward v1.0.0. Entries move under a version heading at release.

### Added

- Repository foundation: .NET 10 solution, React + TypeScript + Vite + Tailwind CSS web client, shared build
  settings with nullable references, warnings as errors and XML documentation.
- Encrypted SQLite storage in SQLCipher v4 format via SQLite3 Multiple Ciphers, with tests proving the file is
  unreadable without the key.
- Single-container Docker image: multi-architecture build, chiseled non-root runtime, built-in health check,
  read-only root filesystem in `docker-compose.yml`.
- `/healthz` health endpoint; client-side routes fall back to the SPA while unknown API routes return 404.
- Third-party license policy (`docs/licensing.md`) and automated dependency license check
  (`scripts/check-licenses.py`).
- PolyForm Noncommercial 1.0.0 license.
- Key hierarchy derived from `MAPLE_MASTER_KEY` with HKDF-SHA256: database key, key-encryption key and Data
  Protection key-ring key. `MAPLE_MASTER_KEY_FILE` supports Docker secrets; `generate-key` prints a new key.
- Per-user data keys, wrapped with the key-encryption key and bound to the account (crypto-shredding on deletion).
- AES-256-GCM encryption for note bodies, and chunked streaming AES-256-GCM for attachments with random access,
  tamper, truncation and reordering detection.
- Encrypted Data Protection key ring, so a copy of the data volume cannot be used to forge sessions.
- Database schema (users, notes, attachments, tags, instance settings) with automatic migrations and an encrypted
  backup before each migration.
- Accounts: first account becomes administrator, optional open registration, PBKDF2-HMAC-SHA512 password hashing
  (210,000 iterations), lockout after 5 failed attempts, per-IP rate limiting, HttpOnly SameSite=Strict session
  cookies checked against the database on every request, antiforgery tokens, password change and "sign out
  everywhere".
- Administration: open or close registration, list accounts, disable accounts and change roles.
- Notes API: create, read, edit, pin, archive/restore and delete; cursor-paginated feed that stays stable while new
  notes arrive; `#tags` (including nested `#work/meetings`) with a tag list and tag filter; search that works on
  encrypted notes.
- Attachments API: streaming uploads (never buffered whole), encrypted at rest per account setting, HTTP Range
  downloads, size limit (`MAPLE_MAX_UPLOAD_MB`), safe serving (only passive media inline; SVG, HTML and scripts are
  always downloaded), hourly cleanup of abandoned uploads and orphan files.
- Security headers on every response (Content-Security-Policy, nosniff, frame denial, referrer policy), HSTS over
  HTTPS, long-lived caching for fingerprinted assets.
- OpenAPI document with XML documentation and an interactive API reference (`/scalar`) in Development or with
  `MAPLE_API_DOCS=true`.
- Web app: first-run setup, sign-in and registration screens; home feed with a quick-post composer, pinned notes
  and infinite scroll; Markdown rendering with clickable `#tags`; inline editing; pin, archive, restore and delete
  (with confirmation); attachments by file picker, paste or drag-and-drop with upload progress, image previews,
  and inline image, video and audio players; search; tag list; archive view; settings for password, sessions and
  administration.
- Mobile-first responsive layout (navigation drawer on phones, sidebar on wide screens), light and dark themes
  following the system, keyboard shortcuts (Ctrl/⌘+Enter to post, Esc to cancel an edit), accessible dialogs and
  menus, reduced-motion support.
