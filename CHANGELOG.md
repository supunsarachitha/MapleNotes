# Changelog

All notable changes to Maple Notes are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.3.0] - 2026-09-29

A habit tracker, deployment behind Nginx Proxy Manager, and demo backups to try every feature with.

### Added

- **Habit tracker** (Settings → Features, off by default): a Habits tab for ticking off daily habits.
  - Each habit shows the last seven days, with today outlined and arrows to earlier weeks.
  - Habits can be renamed, archived (keeping their history), restored and deleted.
  - A progress chart under the list shows the share of days done per week (last 12) or month (last 12), for all
    habits or one, with the current and best streak.
  - A habit is a note of a new kind, `Habit`: its name as a `# title`, then one `- yyyy-MM-dd` line per day done. So
    habits are encrypted in every mode (in the browser for end-to-end accounts), converted between modes, exported and
    restored like any note.
  - Built from scratch: no code, text or images come from other habit trackers, and no dependency was added.
- **Nginx Proxy Manager:** a Portainer stack (`deploy/portainer-stack-npm.yml`) that trusts NPM's forwarded headers,
  with the Proxy Host settings in its comments, and the Proxy Host's custom configuration
  (`deploy/nginx-proxy-manager.conf`): attachments up to 30 MB instead of nginx's 1 MB, streamed uploads and
  downloads, and longer timeouts for exports.
- **Demo backups** in `demo-backup-samples/`: the same sample account as a Markdown and a JSON export, with notes,
  todo lists, quick notes, daily notes, habits, nested tags, an archive, and photos, a video, a voice memo, a PDF and
  a CSV file. Restore one in Settings → Backup & restore to try every feature. All of it is original.

### Changed

- The API accepts the kind `habit` when listing, creating and importing notes.
  - `PATCH` answers 400 to a change of kind to or from `habit`.
  - Without a `kind`, `GET /api/v1/tags` and `GET /api/v1/notes/calendar` leave habits out.
- Preferences gain `habitTracker` (off by default).
- Exports file habits under `habits/` in every format, and restore reads them back. The browser's export (for
  end-to-end accounts) includes habits too, and the shared export vectors cover them.
- For end-to-end accounts, the server can see which notes are habits and when each changes, so roughly when a habit
  is ticked, but not its name or days. The threat model and the spec say so.
- The side menu fits short windows: below 900 px its items and the calendar are a little smaller, and when the
  window is shorter still, the menu scrolls while the search box and Sign out stay in view.

## [1.2.1] - 2026-09-29

Help when Maple Notes is opened without HTTPS.

### Added

- **A secure-connection notice.** Opened over plain HTTP at an address other than `localhost`, where browsers
  withhold the cryptography Maple Notes needs, the app explains that it needs HTTPS instead of failing at sign-in
  with a misleading error about memory.
- **HTTPS by IP address:** a Portainer stack (`deploy/portainer-stack-https.yml`) that serves Maple Notes through
  Caddy at `https://<server-ip>:8443`, with a certificate from Caddy's own authority, for networks without a domain
  name.
- The README and the in-app help explain why other devices need HTTPS.

## [1.2.0] - 2026-09-29

Titles, todo lists, quick notes, daily notes, and restoring from exports. Every feature works in all three encryption
modes, and each account chooses which ones it uses.

### Added

- **Preferences** per account, shared by all of its devices: `GET`/`PUT /api/v1/account/preferences`, also returned
  with the signed-in user.
- **Note titles** (Settings → Writing, off by default): a title field when writing, stored as the note's first line as
  a Markdown heading. Titles can start with today's date in one of eight formats.
- **Todo lists** (Settings → Features, on by default): a Todo tab for checklists. Add, tick, edit and remove items;
  rename, clear completed, pin, archive and delete lists.
- **Quick notes** (on by default): a Quick notes tab for short notes kept out of the timeline, which can move to Home
  and back.
- **Daily notes** (off by default): today's note at the top of Home, titled with the date and saved when you first
  write. There is one per day, also when two devices start it at once.
- **Appearance** (Settings → Appearance): light, dark or the device's theme, and seven accent colours (Maple, Ocean,
  Forest, Teal, Plum, Amber, Slate), each keeping text contrast at 4.5:1 or better. The device remembers the last
  choice, so the sign-in screen matches.
- **Image viewer:** choosing an image attachment opens it full screen, with previous and next (buttons, arrow keys
  or a swipe) and a download button. End-to-end images are decrypted as usual.
- **Link previews** (Settings → Features, off by default): the title, description and site of links in notes. The
  server fetches the pages, so it sees those links, even for end-to-end accounts. Settings shows this cost next to
  the switch, and turning previews on asks for confirmation in a dialog that explains it. It only
  connects to public addresses: private, loopback, link-local and similar ranges are refused when the connection is
  made, including after redirects and for names that point there. Fetches are limited to http(s) on the standard
  ports, 5 seconds and 512 KB of HTML, and results are cached. `MAPLE_LINK_PREVIEWS=false` turns the feature off for
  the whole server.
- **Storage usage:** Settings → Account shows how much the account stores (notes and files, with counts), from
  `GET /api/v1/account/storage`. Administrators see the server's totals (database, files, backups) and free space
  from `GET /api/v1/admin/storage`, but never another account's usage.
- **Help page:** a user guide in the app, from the side menu, covering every feature with links to the matching
  settings.
- **Formatting toolbar** in every editor: bold, italic, heading, bulleted list, checklist, quote, code and link, with
  Ctrl/⌘+B, I and K. Each change can be undone like typing.
- **Tags page:** every tag with its note count, nested tags under their parents, a filter and A–Z or most-used
  order. The side menu links to it instead of listing tags.
- **Calendar** (on by default): a month calendar in the side menu (and the phone drawer) marks the days with notes,
  in your time zone; choosing a day shows its notes.
- **Restore** (Settings → Backup & restore): bring back Maple Notes exports (`.zip`, any format and layout, with
  attachments) and single `.md`, `.txt` and `.json` files. Notes keep their ID, dates, pinned and archived state, kind
  and daily date. Notes you already have are skipped. For end-to-end accounts the browser encrypts everything first.
- API: notes have a `kind` (`Note`, `Todo`, `Quick`) and a `dailyDate`. `GET /api/v1/notes` and `GET /api/v1/tags`
  take repeatable `kind` parameters. `GET /api/v1/notes` also takes `createdFrom` and `createdBefore`. New endpoints:
  `GET /api/v1/notes/calendar`, `GET /api/v1/notes/daily/{date}`, `POST /api/v1/notes/import` and
  `POST /api/v1/notes/import/existing`.
- **Container images** at `ghcr.io/supunsarachitha/maplenotes` (amd64 and arm64), published from `main` and from
  release tags.
- **A Portainer stack** (`deploy/portainer-stack.yml`) that deploys without changes: it pulls the published image and
  creates the master key on first start, in its own volume. The README shows it, the full `docker-compose.yml` and
  `.env`, and a complete HTTPS setup with Caddy.

### Changed

- **New icon:** the Maple Notes leaf in autumn colours, without the square tile; original artwork, like the emoji in
  spirit but not copied from any emoji font.
- **Settings layout:** Account, Writing, Features, Backup & restore and Password come first. Encryption, the recovery
  key, sessions and account deletion are in a collapsible **Advanced** section, which opens by itself while an
  encryption change is being applied.
- Todo lists no longer lose an item when a refresh from the server arrives just after a quick series of edits (found
  by the browser tests while building 1.2).
- **Exports** record each note's kind and daily date in every format, and file todo lists and quick notes under
  `todo/` and `quick-notes/`. The manifest is version 2.
- Attachment images are responsive: a single image keeps its own shape (never cropped or enlarged, at most 70% of the
  screen height); several become a grid of square thumbnails, three across on wider screens.
- Searches, tag views, tag counts and the archive cover every kind of note that is turned on, with todo lists and
  quick notes labelled.

## [1.1.0] - 2026-09-29

End-to-end encryption: an account can now have its notes, tags and files encrypted in the browser with a key the
server never sees. See the README's upgrade notes before upgrading from 1.0.0, and
[docs/threat-model.md](docs/threat-model.md) for what each mode protects.

### Security

- **Key-derived sign-in:** the password never leaves the browser. It is turned into an authentication key with
  Argon2id (64 MiB, 3 passes, run in a Web Worker) and HKDF, and the server stores only a PBKDF2 hash of that key. This
  is the foundation for end-to-end encryption. Accounts created with 1.0.0 upgrade automatically at their next sign-in.
- API responses are sent with `Cache-Control: no-store` unless they set their own caching, so decrypted notes are not
  kept in the browser's disk cache.

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
- **Export for end-to-end accounts**, built in the browser with the same structure as the server's (checked against
  the server's own archives for all 12 format and layout combinations) and streamed to disk through the service worker.
- **Documentation:** the end-to-end encryption specification with shared test vectors (`docs/e2ee-spec.md`), a threat
  model (`docs/threat-model.md`), and upgrade and forgotten-password notes in the README.

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
- `GET /api/v1/export` answers HTTP 409 for an account with end-to-end encrypted content, which only the app can
  export.

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

[Unreleased]: https://github.com/supunsarachitha/MapleNotes/compare/1.3.0...HEAD
[1.3.0]: https://github.com/supunsarachitha/MapleNotes/compare/1.2.1...1.3.0
[1.2.1]: https://github.com/supunsarachitha/MapleNotes/compare/1.2.0...1.2.1
[1.2.0]: https://github.com/supunsarachitha/MapleNotes/compare/1.1.0...1.2.0
[1.1.0]: https://github.com/supunsarachitha/MapleNotes/compare/1.0...1.1.0
[1.0.0]: https://github.com/supunsarachitha/MapleNotes/releases/tag/1.0
