<p align="center">
  <img src="src/maple-web/public/favicon.svg" width="72" height="72" alt="Maple Notes logo">
</p>

<h1 align="center">Maple Notes</h1>

<p align="center">
  A self-hosted place for quick notes, with encryption at rest.<br>
  Timeline feed · Markdown and #tags · attachments · export to Markdown, text or JSON · one Docker container.
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
- **Markdown and tags.** GitHub-flavoured Markdown (task lists, tables, code) and clickable `#tags`, including
  nested tags such as `#work/meetings`, with a tag list and tag filter.
- **Attachments.** Images, video, audio and any other file, added by file picker, paste or drag-and-drop, with
  upload progress. Images and media play inline; video seeking works on iOS.
- **Search.** Finds text in your notes, including encrypted ones.
- **Encryption at rest.**
  - The database is always encrypted.
  - Each account can also encrypt its notes and files with its own key.
  - Switching encryption on or off converts existing notes and files safely in the background.
- **Export.** Download everything, decrypted, as a ZIP of Markdown, plain text or JSON files, in flat or
  year/month/day folders. Attachments are included and linked by relative path.
- **Accounts.** Multiple users with secure authentication. The first account becomes the administrator, who can open
  registration, disable or remove accounts, and appoint other administrators. Administrators never see anyone's notes.
- **Mobile first.** Responsive design with light and dark themes that follow your system, keyboard shortcuts, and
  accessible menus and dialogs.
- **Small and hardened.** One container: non-root, read-only root filesystem, built-in health check.

| Mobile | Settings |
|---|---|
| ![Mobile View](docs/screenshots/mobile-view.png) | ![Settings](docs/screenshots/settings.png) |

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
| Notes and attachments | With encryption at rest on (the default), each account's notes and files are also encrypted with the account's own key, using AES-256-GCM. Each user can switch this in Settings. |
| Passwords | Never leave the browser: it derives a sign-in key with Argon2id (64 MiB), and the server stores only a PBKDF2-HMAC-SHA512 hash of that key (210,000 iterations). Lockout after 5 failed attempts; rate limiting. |
| Sessions | HttpOnly, SameSite=Strict cookies, checked on every request, so a password change or "sign out everywhere" takes effect at once. |
| Web | Strict Content-Security-Policy, antiforgery tokens, and uploaded files never run as web content. |

**What this protects:** anyone who gets a copy of your disk, volume or backups without the master key sees only
ciphertext.

**What it does not protect:** this is encryption at rest, not end-to-end encryption. The server holds the keys while it
runs, so someone who controls the running server, or knows the master key, can read the data. Details:
[docs/architecture.md](docs/architecture.md#cryptography).

## Backups

Everything lives in the data volume. A consistent backup while Maple Notes keeps running:

```sh
# 1. Write an encrypted copy of the database to /app/data/backups
docker exec maple-notes dotnet /app/MapleNotes.Server.dll backup

# 2. Archive the backups, attachments and key ring
docker run --rm -v maple-data:/data -v "$PWD":/out alpine \
  tar czf /out/maple-backup-$(date +%F).tgz -C /data backups attachments keys
```

Keep the master key separately. A backup is useless without it, which is what keeps a leaked backup safe.

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
| Web | React 19, TypeScript, Vite, Tailwind CSS 4, TanStack Query, Radix UI, react-markdown |
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
