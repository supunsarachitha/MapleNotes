<p align="center">
  <img src="src/maple-web/public/favicon.svg" width="72" height="72" alt="Maple Notes logo">
</p>

<h1 align="center">Maple Notes</h1>

<p align="center">
  A self-hosted place for quick notes, encrypted at rest or end to end.<br>
  Timeline feed · todo lists · daily notes · Markdown and #tags · attachments · export and restore · one Docker container.
</p>

<p align="center">
  <a href="https://github.com/supunsarachitha/MapleNotes/actions/workflows/ci.yml"><img src="https://github.com/supunsarachitha/MapleNotes/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <img src="https://img.shields.io/badge/.NET-10%20LTS-512BD4" alt=".NET 10 LTS">
  <img src="https://img.shields.io/badge/license-PolyForm%20Noncommercial-8f1d21" alt="License: PolyForm Noncommercial 1.0.0">
</p>

![Home Feed](docs/screenshots/home-feed.png)

## Features

- **Timeline feed.** Newest notes first, a quick-post box at the top, pinned notes above the feed, and infinite
  scroll that stays stable while new notes arrive.
- **Full note lifecycle.** Create, edit inline, pin, archive (and restore), and delete (with confirmation).
- **Titles and dates.** Optionally give notes a title, which can start with today's date in the format you choose.
- **Todo lists.** A Todo tab for checklists: add items, tick them off, rename, pin and archive lists.
- **Quick notes.** A scratchpad tab for short notes that stay out of your timeline; move one to Home when it is worth
  keeping.
- **Daily notes.** Optionally, today's note at the top of Home, titled with the date and saved when you first write.
- **Calendar.** A month calendar in the side menu marks the days you wrote on; choose a day to see its notes.
- **Your choice of features.** Each account turns titles, todo lists, quick notes, daily notes and the calendar on or off in
  Settings, on every device at once. Turning a feature off hides it and deletes nothing.
- **Markdown and tags.** GitHub-flavoured Markdown (task lists, tables, code) and clickable `#tags`, including
  nested tags such as `#work/meetings`, with a tag list and tag filter.
- **Attachments.** Images, video, audio and any other file, added by file picker, paste or drag-and-drop, with
  upload progress. Images keep their shape on any screen and open in a full-screen viewer; audio and video play
  inline, and video seeking works on iOS.
- **Search.** Finds text in your notes, including encrypted ones. With end-to-end encryption, search runs in your
  browser.
- **Encryption, chosen per account.**
  - The database is always encrypted.
  - **Encrypted at rest** (the default): each account's notes and files are also encrypted with its own key, which
    the server holds.
  - **End-to-end**: your browser encrypts notes, tags, file names and files with a key only you hold. The server
    stores ciphertext it cannot read, and a recovery key lets you reset a forgotten password.
  - Changing mode converts existing notes and files safely, resuming if it is interrupted.
- **Export and restore.** Download everything, decrypted, as a ZIP of Markdown, plain text or JSON files, in flat or
  year/month/day folders, with attachments linked by relative path. Restore such an export into any account, even on
  another server: notes keep their dates, pins, archive state, kind and files, and notes you already have are skipped.
  Single Markdown, text and JSON files can be added too. With end-to-end encryption, your browser does both.
- **Accounts.** Multiple users with secure authentication. The first account becomes the administrator, who can open
  registration, disable or remove accounts, and appoint other administrators. Administrators never see anyone's notes.
- **Mobile first.** Responsive design, keyboard shortcuts, and accessible menus and dialogs.
- **Appearance.** Light or dark (or follow your device), and seven accent colours, chosen in Settings and applied on
  every device.
- **Small and hardened.** One container: non-root, read-only root filesystem, built-in health check.

| Mobile | Todo lists | Settings |
|---|---|---|
| ![Mobile View](docs/screenshots/mobile-view.png) | ![Todo lists](docs/screenshots/todo.png) | ![Settings](docs/screenshots/settings.png) |

Dark mode: [screenshot](docs/screenshots/home-feed-dark.png).

## Quick start

You need Docker. Maple Notes listens on port 8080 inside the container; put it behind an HTTPS reverse proxy for
use over the internet (see [Reverse proxy](#reverse-proxy-and-https)).

### Docker Compose (recommended)

```sh
git clone https://github.com/supunsarachitha/MapleNotes.git
cd MapleNotes
cp .env.example .env

# Create the master key and put it in .env as MAPLE_MASTER_KEY=...
openssl rand -base64 32

docker compose up -d --build
```

Open <http://localhost:8080> and create the first account. It becomes the administrator.

> [!IMPORTANT]
> **Save your master key somewhere safe, such as a password manager, separately from your backups.**
> It encrypts everything. Without it your data cannot be recovered, by you or by anyone else.

### docker run

```sh
docker build -t maple-notes .

# Create a master key and save it safely.
docker run --rm maple-notes generate-key

docker run -d --name maple-notes \
  -p 8080:8080 \
  -e MAPLE_MASTER_KEY='<your key>' \
  -v maple-data:/app/data \
  --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges:true \
  --restart unless-stopped \
  maple-notes
```

To use a Docker secret instead of an environment variable, set `MAPLE_MASTER_KEY_FILE` to the secret's path
(see the commented example in `docker-compose.yml`).

**Bind mounts:** if you mount a host directory instead of a named volume, make it writable by the container's user:
`sudo chown -R 1654:1654 ./data`.

## Configuration

All settings are environment variables.

| Variable | Default | Description |
|---|---|---|
| `MAPLE_MASTER_KEY` | — | **Required.** Base64 256-bit root key (`openssl rand -base64 32`). Never stored in the data volume. |
| `MAPLE_MASTER_KEY_FILE` | — | Path to a file containing the key (Docker secrets). Use instead of `MAPLE_MASTER_KEY`. |
| `MAPLE_DATA_DIR` | `/app/data` | Database, attachments, key ring and backups. Mount a volume here. |
| `MAPLE_ALLOW_REGISTRATION` | `false` | Let visitors create accounts. The first account can always be created. Administrators can also change this in Settings. |
| `MAPLE_DEFAULT_ENCRYPTION` | `true` | Whether new accounts start with encryption at rest on. |
| `MAPLE_MAX_UPLOAD_MB` | `25` | Largest attachment, 1–2048 MB. |
| `MAPLE_TRUSTED_PROXIES` | — | Reverse proxy addresses or CIDR ranges whose `X-Forwarded-*` headers are trusted, e.g. `172.16.0.0/12`. |
| `MAPLE_AUTH_RATE_LIMIT` | `10` | Sign-in, registration and password attempts per client IP per minute (prelogin has a separate budget of the same size). |
| `MAPLE_API_DOCS` | `false` | Publish the OpenAPI document (`/openapi/v1.json`) and API reference (`/scalar`). |
| `ASPNETCORE_HTTP_PORTS` | `8080` | Port inside the container. |
| `AllowedHosts` | `*` | Restrict accepted host names, e.g. `notes.example.com`. |

With `docker compose`, put these in `.env`; `docker-compose.yml` passes the common ones through.

## Security model

| What | How |
|---|---|
| Database | The whole SQLite file is encrypted (SQLCipher v4 format, AES-256) with a key derived from the master key. Always on. |
| Notes and attachments | Each account chooses a mode in Settings. **Encrypted at rest** (the default): notes and files are also encrypted with the account's own key, which the server holds (AES-256-GCM). **End-to-end**: the browser encrypts notes, file names and files with a key the server never sees (AES-256-GCM), and tags become keyed tokens. **Off**: only the database encryption applies. |
| End-to-end keys | Created in the browser and stored on the server only in wrapped form: once under a key derived from your password, once under a recovery key that is shown to you once. An open session keeps the key in the browser as a non-extractable key, sealed with a secret that lives in the session cookie. |
| Passwords | Never leave the browser: it derives a sign-in key with Argon2id (64 MiB), and the server stores only a PBKDF2-HMAC-SHA512 hash of that key (210,000 iterations). Lockout after 5 failed attempts; rate limiting. |
| Sessions | HttpOnly, SameSite=Strict cookies, checked on every request, so a password change or "sign out everywhere" takes effect at once. |
| Web | Strict Content-Security-Policy, antiforgery tokens, API responses never cached by the browser, and uploaded files never run as web content. |

**What this protects:**
- Anyone who gets a copy of your disk, volume or backups without the master key sees only ciphertext.
- With end-to-end encryption, even the server cannot read your notes, titles, todo items, tags, file names or files.
  Someone with the master key, the database or full control of the server's data sees only ciphertext, sizes,
  timestamps, which kind each note is (timeline, todo list or quick note), which days have a daily note, and your
  feature settings.

**What it does not protect:**
- Without end-to-end encryption, the server holds the keys while it runs, so someone who controls the running server,
  or knows the master key, can read the data.
- End-to-end encryption still trusts the server to deliver honest code to your browser. Someone who takes over the
  server could serve a modified web app that captures your password the next time you sign in. It protects the data
  the server stores, not a session with a server that is already compromised.
- If you lose both your password and your recovery key, end-to-end encrypted notes cannot be recovered by anyone.

Details: [docs/threat-model.md](docs/threat-model.md), [docs/architecture.md](docs/architecture.md#cryptography) and
[docs/e2ee-spec.md](docs/e2ee-spec.md).

### Forgotten passwords

Maple Notes sends no email, so there are no reset links. With end-to-end encryption, choose **Forgot your password?**
on the sign-in page and enter your recovery key: you set a new password and get a new recovery key. Accounts without
end-to-end encryption cannot reset a forgotten password; keep it in a password manager.

## Backups

Every user can download their own notes from **Settings → Backup & restore** and restore them there, into the same
account or a new one on any Maple Notes 1.2 server. For the whole instance, back up the data volume.

Everything lives in the data volume. A consistent backup while Maple Notes keeps running:

```sh
# 1. Write an encrypted copy of the database to /app/data/backups
docker exec maple-notes dotnet /app/MapleNotes.Server.dll backup

# 2. Archive the backups, attachments and key ring
docker run --rm -v maple-data:/data -v "$PWD":/out alpine \
  tar czf /out/maple-backup-$(date +%F).tgz -C /data backups attachments keys
```

Keep the master key separately. A backup is useless without it, which is what keeps a leaked backup safe.
End-to-end encrypted content stays encrypted in backups too: after a restore it opens with the same passwords and
recovery keys as before.

**To restore:**
1. Stop the container.
2. Put `attachments/` and `keys/` back into the volume, and copy the chosen database backup to `maple.db`.
3. Delete any `maple.db-wal` and `maple.db-shm` files in the volume. They belong to the replaced database and must
   not be applied to the restored one.
4. Start the container with the **same** master key.

Maple Notes also takes an automatic encrypted backup before every database upgrade and keeps the newest five.

## Upgrading

```sh
git pull
docker compose up -d --build
```

Database migrations run automatically at startup, after an automatic backup.

### From 1.1 to 1.2

Nothing to do. Existing notes stay in the timeline, and every account starts with todo lists and quick notes turned
on, and titles and daily notes off. Exports now record each note's kind and daily date (manifest version 2), and
file todo lists and quick notes in their own folders. The API only gained fields and endpoints.

### From 1.0 to 1.1

- **Sign-in changed.** Browsers no longer send passwords; they send a key derived from the password. The next time
  each account signs in (or confirms its password in Settings), the browser sends the password one last time so the
  server can switch the account over. Nothing else is needed, and existing sessions stay signed in.
- **Encryption settings** now offer three modes. Accounts keep their current protection: encryption at rest stays on,
  or stays off.
- **API clients** that signed in with a username and password must follow the new sign-in protocol
  ([docs/e2ee-spec.md](docs/e2ee-spec.md#1-password-derived-keys-every-account)), and the encryption endpoint takes a mode instead of on/off.
  See the [changelog](CHANGELOG.md).

## Reverse proxy and HTTPS

Run Maple Notes behind a TLS-terminating reverse proxy. With [Caddy](https://caddyserver.com) in the same compose
project:

```caddyfile
notes.example.com {
    reverse_proxy maple-notes:8080
}
```

Then tell Maple Notes to trust the proxy's forwarded headers, so it sees real client addresses (for rate limiting)
and HTTPS (for secure cookies and HSTS). For the default Docker network ranges:

```sh
MAPLE_TRUSTED_PROXIES=172.16.0.0/12
```

## Development

Requirements: .NET 10 SDK, Node.js 22.12 or later, Docker (for container builds).

```sh
# API server on http://localhost:5051. It uses a public development key and ./data/dev;
# never use that key for real data.
dotnet run --project src/MapleNotes.Server

# Web app with hot reload on http://localhost:5173 (proxies /api to the server)
cd src/maple-web && npm ci && npm run dev
```

```sh
dotnet test                         # server: unit and integration tests
cd src/maple-web && npm test        # web: Vitest
python3 scripts/check-licenses.py   # dependency license policy
```

In Development, the interactive API reference is at <http://localhost:5051/scalar>.

## Tech stack

| Layer | Technology |
|---|---|
| Server | ASP.NET Core 10 (LTS), controllers, built-in OpenAPI with XML docs |
| Data | Entity Framework Core 10, SQLite with [SQLite3 Multiple Ciphers](https://utelle.github.io/SQLite3MultipleCiphers/) (SQLCipher v4 format) |
| Crypto | .NET `AesGcm` and `HKDF`, ASP.NET Core Data Protection, Identity password hasher; in the browser, WebCrypto and Argon2id from `hash-wasm` |
| Web | React 19, TypeScript, Vite, Tailwind CSS 4, TanStack Query, Radix UI, react-markdown, fflate (ZIP export in the browser), a service worker for encrypted media |
| Tests | xUnit v3, `WebApplicationFactory`, Vitest, Testing Library |
| Container | Multi-stage, multi-architecture build; chiseled Ubuntu runtime image |

Architecture, file formats and design decisions: [docs/architecture.md](docs/architecture.md).

## Acknowledgements

Maple Notes is inspired by [memos](https://github.com/usememos/memos). It is an independent implementation and shares
no code with it.

## License

Maple Notes is **source-available** under the [PolyForm Noncommercial License 1.0.0](LICENSE). You may use,
modify and share it for any noncommercial purpose; commercial use needs a separate license from the copyright holder.

Third-party components keep their own licenses: see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) and
[docs/licensing.md](docs/licensing.md).
