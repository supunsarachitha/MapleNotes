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
