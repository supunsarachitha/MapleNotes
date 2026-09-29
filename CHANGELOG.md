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
