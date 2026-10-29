# Maple Notes: security review and scope of work (release 1.17.1)

- **Repository:** supunsarachitha/MapleNotes (`main` at `6da3af1`, version 1.17.0)
- **Review date:** 2026-10-29
- **Release branch:** `release-1.17.1` (cut from `main`)
- **Tracking issue:** #47

## 1. How the review was done

- **Dependencies:**
  - Ran `npm audit` on the web app, both production-only and full.
  - Queried the OSV vulnerability database for every NuGet package pinned in `Directory.Packages.props`.
- **Server code review (ASP.NET Core, .NET 10):** reviewed authentication, anonymous endpoints, the admin role, rate limiting, the link-preview fetcher (SSRF), attachment upload and download, security headers, the SPA fallback and the Docker image.
- **Web code review (React):** reviewed Markdown rendering, link and image handling, and raw HTML sinks.
- **CI review:** reviewed the GitHub Actions workflows.
- **Not done in this review:**
  - No dynamic testing against a running instance (the .NET SDK is not available in the review environment).
  - No review of the end-to-end crypto maths beyond the spec references.

## 2. Summary

The codebase is already strongly hardened. **No critical or high-severity issue was found in the application code.** One low-to-medium defence-in-depth gap was found in the server. There are also two supply-chain items.

| # | Finding | Severity | Area |
|---|---------|----------|------|
| F1 | Pages under `/scalar` and `/openapi` are served **without a Content-Security-Policy**, including the main web app when API docs are disabled | Low–Medium | Server headers |
| F2 | `undici` (dev/test dependency) has known high-severity advisories | Low (build-time only) | Web dependencies |
| F3 | GitHub Actions are pinned to mutable tags (`@v7`), not commit SHAs, in a workflow that pushes Docker images | Low | CI supply chain |

## 3. Findings

### F1: CSP skipped for `/scalar` and `/openapi` paths

**Where:**
- `src/MapleNotes.Server/Infrastructure/Web/SecurityHeaders.cs`, lines 53–57
- `src/MapleNotes.Server/Program.cs`, lines 90–105

**What happens:**
- The security-header middleware skips the app Content-Security-Policy for any request path starting with `/scalar` or `/openapi`. It does this because the optional API reference page needs inline scripts.
- The skip is unconditional. It applies even when the API reference is **disabled**, which is the default in production (`MAPLE_API_DOCS` unset).
- In that case `/scalar` and `/openapi/...` are not mapped. The request falls through to `MapFallbackToFile("index.html")`.
- The result is that the **full Maple Notes web app is served without its CSP** at URLs such as `https://notes.example/scalar` or `https://notes.example/scalar/anything`.

**Impact:**
- The CSP (`script-src 'self'`, `connect-src 'self'`, `frame-ancestors 'none'` …) is the main safety net if an HTML/script injection bug ever appears in the web app.
- An attacker who finds such a bug can send a victim a `/scalar/...` link to get the app running with no CSP. Decrypted notes and the end-to-end key material in the browser would then be exposed.
- `X-Frame-Options: DENY` is still sent, so clickjacking stays blocked.
- **No exploitable injection was found today.** This is a defence-in-depth gap, not a live exploit.
- When API docs **are** enabled, the Scalar page itself also runs with no CSP on the same origin as the app session.

**Fix:**
1. Exempt `/scalar` and `/openapi` from the app CSP **only when the API reference is actually enabled**. Read the same `IsDevelopment() || ApiDocs` condition used in `Program.cs`.
2. Even when enabled, give the reference page its own restrictive CSP rather than none. Allow `'unsafe-inline'` only for scripts and styles, keep `connect-src 'self'`, `frame-ancestors 'none'` and `object-src 'none'`, and keep the default `img-src`.
3. Add server tests:
   - With API docs off, `GET /scalar` and `GET /scalar/x` return the app CSP header.
   - With API docs on, `GET /scalar` returns the reference-page CSP, not none.
4. Update `docs/threat-model.md` (security headers section) to describe the behaviour.

**Acceptance:**
- No HTML response from the server lacks a `Content-Security-Policy` header.
- The new tests pass and the existing suite stays green.

### F2: `undici` advisories (dev dependency)

**Where:** `src/maple-web/package-lock.json`. `undici` 8.11.2 is pulled in by dev and test tooling (jsdom/vitest). It is **not** in the production bundle: `npm audit --omit=dev` reports 0 vulnerabilities.

**Advisories:**
- Unbounded memory in the EventSource parser (DoS)
- Subresource Integrity bypass via non-lowercase algorithm tokens

**Impact:** Limited to developer machines and CI runners while tests run. No effect on deployed instances.

**Fix:**
1. Merge Dependabot PR **#46** (undici 8.11.2 → 8.12.3), or apply the same bump on the release branch.
2. Re-run `npm audit` and expect 0 vulnerabilities. Run `npm run typecheck`, `npm test` and `npm run build`.

### F3: Actions pinned to tags, not SHAs

**Where:** `.github/workflows/ci.yml` and `.github/workflows/pages.yml`. These use `actions/checkout@v7`, `docker/login-action@v4`, `docker/build-push-action@v7` and others.

**Impact:**
- The Docker job logs in to the registry and **pushes the release image**.
- If an upstream action tag were moved to malicious code, it could steal registry credentials or alter the published image.
- This is a known industry-wide risk, not a sign of compromise.

**Fix:**
1. Pin every third-party action to a full commit SHA, with the tag in a trailing comment (e.g. `uses: actions/checkout@<sha> # v7`).
2. Add a Dependabot `github-actions` ecosystem entry so the pins keep updating.
3. Confirm each job's `permissions:` is minimal. They are already scoped; keep it so.

## 4. Areas reviewed and found sound (no change needed)

- **SSRF in link previews:**
  - Only http/https on default ports are allowed; userinfo is rejected.
  - Literal and resolved addresses are both checked against private, loopback, link-local, CGNAT, metadata and reserved ranges, including the IPv4 address inside NAT64 and 6to4.
  - The check runs inside `ConnectCallback`, which defeats DNS rebinding.
  - Redirects are handled manually and re-validated (max 3).
  - `UseProxy = false`, and only HTML is parsed, from a capped read.
- **Attachments:**
  - Content type comes from an allow-list, otherwise `application/octet-stream`.
  - Every response carries `nosniff` and a sandboxing `default-src 'none'; sandbox` CSP.
  - File names are sanitised (including bidi controls).
  - Storage keys are server-generated.
- **Auth:**
  - HttpOnly, `SameSite=Strict` cookie plus antiforgery on state-changing requests.
  - The security stamp is re-validated on each request, so sign-out-everywhere and password changes revoke sessions.
  - Login, register, recovery and password change are rate-limited per client (IPv6 grouped by /64).
  - Unknown usernames get indistinguishable prelogin answers.
  - Argon2 password hashing.
- **Authorization:** secure-by-default fallback policy (every endpoint needs sign-in unless `[AllowAnonymous]`). Admin controllers are role-guarded. Admins cannot demote or disable their own account.
- **Web rendering:**
  - `react-markdown` without `rehype-raw`, so raw HTML is not rendered and default URL sanitising blocks `javascript:` links.
  - Images are limited to the app's own attachment URLs.
  - External links use `noopener noreferrer nofollow`.
  - No `dangerouslySetInnerHTML` or `eval`.
- **Container:**
  - Chiseled runtime image with no shell, running as non-root UID 1654.
  - The compose file uses a read-only root FS, `cap_drop: ALL` and `no-new-privileges`.
  - Master key via environment variable or Docker secret.
- **NuGet packages:** no OSV advisories for any pinned version.

## 5. Housekeeping (not a vulnerability)

- Remote branch `claude/gracious-cray-qe7kps` is 1 commit ahead of and 37 behind `main` ("Let administrators offer notebooks kept on the device"). Decide whether to merge it or delete it.

## 6. Work plan for `release-1.17.1`

| Phase | Work | Deliverable |
|-------|------|-------------|
| 1 | F1 server fix + tests + threat-model note | Commit on `release-1.17.1`, `dotnet test` green in CI |
| 2 | F2 undici bump (or merge #46 first and rebase) | `npm audit` clean, web tests/build green |
| 3 | F3 pin actions to SHAs + Dependabot for actions | CI passes on the branch |
| 4 | Version bump 1.17.0 → 1.17.1 (`Directory.Build.props`, `Dockerfile`, `package.json`, lock file) + CHANGELOG "Security" entry | PR `release-1.17.1` → `main` |

After each phase: commit, push, and post a progress comment on the tracking issue. Merge to `main` only after approval.

**Estimated effort:**
- Phase 1: about 2 h
- Phases 2 and 3: under 1 h each
- Phase 4: about 30 min

**Risk:** low. F1 changes headers on only a few rarely used paths. F3 is mechanical.
