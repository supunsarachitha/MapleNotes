# Maple Notes: notes for working on this repository

A self-hosted notes app: an ASP.NET Core server (`src/MapleNotes.Server`, .NET 10, SQLite with SQLCipher) serving a React
web app (`src/maple-web`, Vite, TypeScript). One Docker container. Read `README.md` for features, `docs/architecture.md`
for how the parts fit, `docs/e2ee-spec.md` and `docs/threat-model.md` before touching anything security-relevant, and
`docs/roadmap.md` for the numbered list of features still missing.

## Commands

Cloud sessions run `.claude/hooks/session-start.sh`, which installs the .NET SDK and restores packages.

- Server build (warnings are errors): `dotnet build`
- Server tests: `dotnet test --project tests/MapleNotes.Server.Tests`, one class with
  `-- --filter-class "*BrandingTests"`, one test with `-- --filter-method "*Some_test_name*"`
- Web app, in `src/maple-web`: `npm run typecheck`, `npm test` (Vitest), `npx vitest run src/lib/foo.test.ts`,
  `npm run build`
- Database migration: `dotnet ef migrations add <Name> --project src/MapleNotes.Server --output-dir Infrastructure/Persistence/Migrations`
- Run the app locally: `npm run build` in `src/maple-web`, then from `src/MapleNotes.Server`:
  `MAPLE_MASTER_KEY=$(head -c 32 /dev/urandom | base64) MAPLE_DATA_DIR=<scratch dir> ASPNETCORE_WEBROOT=<repo>/src/maple-web/dist ASPNETCORE_URLS=http://localhost:5051 dotnet run --no-launch-profile`.
  Without `--no-launch-profile` the launch profile overrides these and writes to `data/dev` in the repository.
  `localhost` counts as a secure context, which the app needs for Web Crypto. Chromium for Playwright is in
  `/opt/pw-browsers`.

CI (`.github/workflows/ci.yml`) runs the server build and tests, the web type check, tests and build, and
`python3 scripts/check-licenses.py`.

## Things that must stay in step

- **Two exporters.** End-to-end accounts export in the browser (`src/maple-web/src/export`), others on the server
  (`Features/Export`). Both must write identical archives: after changing the export format, run
  `MAPLE_WRITE_VECTORS=1 dotnet test --project tests/MapleNotes.Server.Tests -- --filter-class "*ExportVectorTests"` to
  regenerate `src/maple-web/src/export/export-vectors.json`, then the web tests check the browser's output against it.
  Restore (`src/maple-web/src/import`) reads both.
- **Crypto on both sides.** The browser encrypts (`src/maple-web/src/crypto`); the tests mirror it in C#
  (`tests/MapleNotes.Server.Tests/TestSupport/E2eeCrypto.cs`). Formats and HKDF contexts are specified in
  `docs/e2ee-spec.md`; change the spec with the code.
- **Preferences** live in `Domain/UserPreferences.cs` (validated in `Features/Preferences/PreferencesService.cs`) and
  `src/maple-web/src/lib/types.ts` plus `DEFAULT_PREFERENCES` in `lib/preferences.ts`. They are stored as JSON, so a new
  preference needs no migration.

## Releases

Work goes on a release branch from `main` named `release-x.y.z` (new feature: minor; fix: patch). A release bumps the
version in `Directory.Build.props`, `Dockerfile` (`org.opencontainers.image.version`), `src/maple-web/package.json` and
the two version fields at the top of `src/maple-web/package-lock.json`. Add a dated section to `CHANGELOG.md` (Keep a
Changelog, with the compare links at the bottom) and, when users or API clients must know something, a "From x to y"
note under Upgrading in `README.md`. Do not open pull requests unless asked.

## Conventions

- Every behaviour change comes with a test; for a bug fix, check that the test fails without the fix.
- Code comments and docs explain why, in plain sentences. Documentation follows the surrounding style: short
  paragraphs, no marketing language.
- Security defaults: API responses are `no-store`, uploads are never served as active content, and every query is
  scoped to the signed-in user. End-to-end mode must hold against a compromised server that serves the genuine app
  (see the threat model), so the browser never acts on the server's word alone where that would expose plaintext.
- User-facing text that explains a feature also belongs in the in-app guide (`src/maple-web/src/help/guide.ts`).
