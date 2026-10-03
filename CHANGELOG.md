# Changelog

All notable changes to Maple Notes are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security

Fixes from the October 2026 security audit ([docs/security-audit-2026-10.md](docs/security-audit-2026-10.md)):

- The browser sends a password itself (to upgrade a 1.0 account) only at sign-in, and never for an account it has
  already signed in to with a derived key; a server could otherwise ask for it and open the end-to-end key.
- A crafted page could keep the link-preview parser busy for minutes per request; only the page's head is parsed now,
  in linear time.
- Wrong passwords sent at the same moment are all counted, so the five-attempt lockout holds.
- Converting notes to or from end-to-end encryption can no longer store more than the notes themselves, past the
  storage limit.
- The service worker refuses encrypted files with chunks missing instead of serving them shortened.
- The link-preview limit is per account as documented, IPv6 clients are limited per /64, and previews are cached per
  account, without the URL fragment, in a bounded cache.
- Decrypted attachments are no longer kept in the browser's disk cache.
- Smaller fixes: unknown admin roles are refused; the trash purge keeps notes restored meanwhile; `//host` links open as
  other sites; Markdown images show only the account's own attachments; restores refuse ZIP entries with impossible
  sizes; upload names lose text-reordering characters; the database's write-ahead log is truncated after checkpoints.

## [1.10.1] - 2026-10-03

### Fixed

- With end-to-end encryption, downloading an image from the image viewer, or a file from its chip, failed in browsers
  that use the app's media service worker (most of them). The links asked the browser to download directly, which
  skips the service worker, so the request reached the server, which cannot decrypt the file and answered "not
  found". They now go through the service worker, which decrypts the file and names it.

## [1.10.0] - 2026-10-02

### Added

- **Photo size** (Settings → Features, with Shrink photos before uploading on): choose how far photos shrink. **Large**
  (2560 pixels on the longest side, JPEG quality 85%) is the size photos were shrunk to before, and stays the default;
  **Medium** (1920 pixels, 80%) and **Small** (1280 pixels, 75%) save much more space. In a test with a 12-megapixel
  photo, Large kept about 14% of the original, Medium 5% and Small 2%. Preferences gained `photoSize`.

### Changed

- Shrinking photos now uses the browser's high-quality smoothing, so downscaled photos stay sharper.

## [1.9.0] - 2026-10-02

Labels in exports and restores, and Help can leave the side menu.

### Added

- **Labels in exports:** every export format lists each note's labels by name (`labels:` in Markdown front matter and
  JSON, `Labels:` in plain text), and `manifest.json` lists the colours of the labels the exported notes carry
  (manifest version 3). End-to-end accounts get the same archive from the browser, which decrypts label names; a label
  whose name does not decrypt is left out and reported in the manifest.
- **Labels in restores:** restoring an export brings each note's labels back. A label is matched by name (ignoring
  case) to one the account has, or created in the colour it had; one that cannot be created, for example past the
  limit of 100, is reported and the notes arrive without it. `POST /api/v1/notes/import` takes `labelIds`.
- **Help in the menu** (Settings → Features, on by default): turn it off to hide Help from the side menu. The guide
  stays at `/help`.

### Changed

- An account with end-to-end label names is always exported by the browser, even without end-to-end notes or files.

## [1.8.1] - 2026-10-01

### Fixed

- Opening **Labels…** from a note's ⋯ menu no longer puts the cursor in the find-or-create field, so a phone's
  keyboard stays down until you tap the field.

## [1.8.0] - 2026-10-01

A trash, coloured labels, tag suggestions, a side menu in your own order, Settings in sections, and long timelines
that open quickly.

### Added

- **Trash** (Settings → Features, on by default): deleting a note, todo list or habit moves it to the trash, and Undo
  in the message brings it straight back. The trash is not in the side menu; it opens from Settings → Backup & data,
  where each item can be restored to where it was or deleted forever, and the whole trash emptied. Items are deleted
  for good after 30 days by a background job. Until then they count towards storage, and they are left out of the
  timeline, searches, tags, labels, the calendar and exports. A daily note moved to the trash gives up its day. With
  the trash off, deleting asks first and is permanent, as before.
- **Labels** (Settings → Labels, off by default): coloured labels, in ten colours, that you put on notes and todo
  lists by hand from their ⋯ menu, creating new ones as you go. A note shows its labels as chips; choosing one, or a
  label in the side menu, lists its notes. Settings → Labels creates, renames, recolours and deletes them. Up to 100
  labels, 40 characters each, and 20 on a note. With end-to-end encryption, label names are encrypted in the browser
  for each label's ID (docs/e2ee-spec.md §4a); colours, and which notes carry a label, are not. Changing to or from
  end-to-end encryption converts label names with the rest. Exports do not include labels yet.
- **Tag suggestions** (Settings → Writing, off by default): typing `#` in a note offers the tags you already use that
  match, most used first, next to the cursor. Arrows and Enter or Tab choose one, Esc closes the list, and a tap works
  too.
- **Menu order** (Settings → Side menu): drag the side menu's items by their handle, or move them with their arrows,
  into the order you use them, on every device. Back to the usual order is one button.

### Changed

- **Settings in sections:** Account, Appearance, Side menu, Writing, Features, Labels, Backup & data, Privacy &
  security and, for administrators, Administration. Wide screens show the list beside the open section; phones show
  the list, and each section on its own page. Each section has its own address (`/settings/features`, for example),
  so Back and links from Help work. The collapsed Advanced section is gone: encryption, the recovery key, sessions and
  the password are under Privacy & security, starting over under Backup & data, and deleting the account under
  Account. Features are grouped into Pages, Home and menu, and Notes and files.
- **Editing starts at the end:** editing a note, a todo item, a list's name or items as Markdown, a habit's name, a
  label's name or the display name puts the cursor after the text, ready to carry on.
- **Long timelines open quickly:** players, the decryption of end-to-end files in the page and link previews wait
  until their note comes near the screen, and cards far off screen are not laid out. On the server, a new index lets
  the feed, the pinned notes and the tag and label counts be read from the index alone. Tag counts are now one query
  instead of one per tag. With 3,000 notes, the tag list went from about 5 seconds to 5 ms and the pinned notes from
  29 ms to 1.5 ms.
- API: notes have `labelIds` and `trashedAtUtc`. Lists take `state=trash` and `label`. `PATCH /api/v1/notes/{id}`
  takes `isTrashed` and `labelIds`. `DELETE /api/v1/notes/trash` empties the trash; `DELETE /api/v1/notes/{id}` still
  deletes for good. New: `GET`/`POST /api/v1/labels` and `PUT`/`DELETE /api/v1/labels/{id}`. Preferences gain
  `tagSuggestions`, `labels`, `trash` and `menuOrder` (comma-separated). Conversion batches gain `labels`. Deleting
  all of an account's content also deletes its labels.

## [1.7.0] - 2026-09-30

Titles for quick notes, checkboxes you can tick right in a note, double-tap to edit, and editing a whole todo list as
Markdown.

### Added

- **Titles on quick notes** (Settings → Writing, off by default): with note titles on, quick notes get a title field
  too, both when you jot one down and when you edit it.
- **Double-tap to edit** (Settings → Features, off by default): double-tap a note on a touch screen, or double-click
  it, to edit it. Links, checkboxes, pictures, players and the note's menu work as before, and archived notes are
  left alone.
- **Edit as Markdown** (a todo list's ⋯ menu): all of a list's items in one text box, one `- [ ]` or `- [x]` line
  each, to change, reorder, add or remove many at once. Lines without a box become items to do. Ctrl/⌘+Enter saves
  and Esc cancels.

### Fixed

- **Checkboxes in notes** (task lists such as `- [ ] stamps`) could not be ticked. They now tick and untick with a
  tap in quick notes, timeline notes and daily notes alike; the tick shows at once and the note is saved in the
  background. Archived notes keep theirs as they are.

### Changed

- API: preferences gain `quickNoteTitles` and `doubleTapToEdit`.

## [1.6.0] - 2026-09-30

Your own name and icon for the app, and more ways for each person to set it up for themselves.

### Added

- **App name and icon** (Settings → Administration → Name and icon): administrators rename the app and give it their
  own icon. Both show in the menu, the browser tab, the Help page and the sign-in page. The icon is fitted into
  256 × 256 pixels in the browser and must be a PNG, JPEG or WebP image of at most 256 KB, which the server checks by
  its content; it is served sandboxed, like attachments. "Use the maple leaf" goes back to the original.
- **Display name** (Settings → Account → Change): each person changes the name shown in the menu and to
  administrators; an empty name goes back to the username.
- **Menu text size** (Settings → Appearance): small, medium or large items in the side menu.
- **Week starts on** (Settings → Appearance): automatic, Sunday, Monday or Saturday, for the calendars and the weekly
  habit chart.
- **Archive and Tags page** switches (Settings → Features, on by default). Turning Archive off hides the page and the
  Archive action on notes and lists; archived notes are kept. Turning the Tags page off hides it; tags in notes still
  work.
- **Version number** at the foot of Settings and Help, for signed-in users only.

### Changed

- API: the sign-in status has `branding` (the app's name and icon address), and `version` for signed-in users.
  `GET`/`PUT /api/v1/admin/settings` have `appName`. New endpoints: `GET /api/v1/branding/icon`,
  `PUT`/`DELETE /api/v1/admin/branding/icon` and `PUT /api/v1/account/display-name`. Preferences gain `archive`,
  `tags`, `menuTextSize` and `weekStart`.

## [1.5.0] - 2026-09-30

A month calendar for the habit tracker.

### Added

- **Habit calendar:** a month calendar under the progress chart on the Habits page. For one habit it marks the days
  done; for all habits it marks the days all or some were done. Days before a habit started, and after today, do not
  count. Arrows go back a month at a time, and the month's total is shown underneath.

## [1.4.0] - 2026-09-30

The first stable release. It adds a storage limit per account, deleting all of one's notes and files at once,
shrinking photos before they upload, and compacting the database.

### Added

- **Storage limit** (Settings → Administration, off by default): administrators set how much each account can store,
  notes and files together, from 1 MB to 16 TB. It applies to every account, administrators included.
  - Uploads, new notes, edits that make a note longer and restores are refused once they would pass the limit, with
    HTTP 507 and a message saying to make room. Deleting, archiving, and changing encryption modes always work, even
    over the limit. Lowering the limit below what an account stores deletes nothing.
  - Settings → Account shows usage against the limit, and warns when it is almost or completely full.
  - A restore stops at the first note that does not fit; running it again after making room skips what is already
    back.
  - Administrators still see the server's totals only, never how much an account stores.
- **Delete all notes and files** (Settings → Advanced): an account deletes every note, todo list, quick note, daily
  note, habit, tag and file at once, after confirming its password, and keeps its username, password, encryption
  keys, settings and sessions.
- **Shrink photos before uploading** (Settings → Features, off by default): the browser resizes photos to at most
  2560 pixels on their longest side and re-saves them as JPEG before they upload, keeping the original only when
  that would not save at least a tenth or would lose transparency. It works with end-to-end encryption, since it
  happens before the file is encrypted, and it leaves out the location and camera details photos carry.
- **Compact database** (Settings → Administration): rebuilds the database without the space deleted notes left
  behind (SQLite `VACUUM`, still encrypted) and gives it back to the disk, showing the size before and after.

### Changed

- API: `GET`/`PUT /api/v1/admin/settings` have `storageQuotaMb` (null for no limit). `PUT` replaces the settings, so
  leaving it out removes the limit. `GET /api/v1/account/storage` has `quotaBytes`.
- API: `DELETE /api/v1/account/content` (with a password proof) deletes the account's content;
  `POST /api/v1/admin/storage/compact` compacts the database; preferences gain `shrinkPhotos`.

### Removed

- The acknowledgement of memos, from the README and the licensing policy.

## [1.3.1] - 2026-09-30

The first 1.3 release with container images: the build of the `1.3.0` tag stopped at a documentation test, so no
`1.3.0` image was published.

### Fixed

- The README's Nginx Proxy Manager section, lost while merging 1.3.0, is back, so the documentation tests pass again.

### Changed

- The demo backups include habits: three with about ten weeks of history and streaks, and an archived one.
- The README explains how to try Maple Notes with the demo backups, and how to upgrade a Portainer or `docker run`
  install.
- CI uses the Node.js 24 versions of its actions and runs on Ubuntu 24.04.
- The finished development plans are no longer in `docs/`, and this changelog now matches the published tags.

### Removed

- Unused code in the server, the tests and the web app.

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

[Unreleased]: https://github.com/supunsarachitha/MapleNotes/compare/v1.10.1...HEAD
[1.10.1]: https://github.com/supunsarachitha/MapleNotes/compare/v1.10.0...v1.10.1
[1.10.0]: https://github.com/supunsarachitha/MapleNotes/compare/v1.9.0...v1.10.0
[1.9.0]: https://github.com/supunsarachitha/MapleNotes/compare/v1.8.1...v1.9.0
[1.8.1]: https://github.com/supunsarachitha/MapleNotes/compare/v1.8.0...v1.8.1
[1.8.0]: https://github.com/supunsarachitha/MapleNotes/compare/v1.7.0...v1.8.0
[1.7.0]: https://github.com/supunsarachitha/MapleNotes/compare/v1.6.0...v1.7.0
[1.6.0]: https://github.com/supunsarachitha/MapleNotes/compare/v1.5.0...v1.6.0
[1.5.0]: https://github.com/supunsarachitha/MapleNotes/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/supunsarachitha/MapleNotes/compare/1.3.1...v1.4.0
[1.3.1]: https://github.com/supunsarachitha/MapleNotes/compare/1.3.0...1.3.1
[1.3.0]: https://github.com/supunsarachitha/MapleNotes/compare/1.2.1...1.3.0
[1.2.1]: https://github.com/supunsarachitha/MapleNotes/compare/1.2.0...1.2.1
[1.2.0]: https://github.com/supunsarachitha/MapleNotes/compare/1.1.0...1.2.0
[1.1.0]: https://github.com/supunsarachitha/MapleNotes/compare/1.0...1.1.0
[1.0.0]: https://github.com/supunsarachitha/MapleNotes/releases/tag/1.0
