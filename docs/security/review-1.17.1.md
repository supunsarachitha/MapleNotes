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

The codebase is already strongly hardened. **No critical or high-severity issue was found in the application code.** One low-severity hardening gap was found in the server (first reported as low–medium; corrected in phase 1). There are also two supply-chain items.

| # | Finding | Severity | Area |
|---|---------|----------|------|
| F1 | The optional API reference page (`/scalar`) is served with **no Content-Security-Policy** when enabled, and the header code exempts `/openapi` for no reason | Low (opt-in feature, hardening) | Server headers |
| F2 | `undici` (dev/test dependency) has known high-severity advisories | Low (build-time only) | Web dependencies |
| F3 | GitHub Actions are pinned to mutable tags (`@v7`), not commit SHAs, in a workflow that pushes Docker images | Low | CI supply chain |

## 3. Findings

### F1: No CSP on the API reference page (corrected during phase 1)

**Where:**
- `src/MapleNotes.Server/Infrastructure/Web/SecurityHeaders.cs`
- `src/MapleNotes.Server/Program.cs`

**What happens:**
- The security-header middleware skipped the Content-Security-Policy for every path starting with `/scalar` or `/openapi`.
- When the interactive API reference is switched on (Development or `MAPLE_API_DOCS=true`, off by default), the Scalar page ran with no policy at all, on the same origin as the user's session.
- `/openapi/v1.json` is a JSON document. It never needed an exemption.

**Correction to the first draft:** the first draft said that with API docs off, `/scalar/...` served the full web app without its CSP. Tests in phase 1 showed this is **not** the case. The SPA fallback rewrites the request path to `/index.html` before the headers are written, so the app policy was still applied. The real gap is limited to the opt-in reference page, so severity is lowered to **Low (hardening)**.

**Fix (done in phase 1):**
1. The reference page gets its own policy, `ApiReferenceContentSecurityPolicy`. It allows the page's single inline script, but loads code only from this origin, allows `connect-src 'self'`, sets `object-src 'none'` and `frame-ancestors 'none'`.
2. The exemption applies only when the reference is actually enabled, so it no longer depends on the fallback's path rewrite.
3. `/openapi` is no longer exempt and gets the app policy.
4. Tests:
   - The app policy is kept on `/scalar`, `/scalar/v1`, `/openapi/v1.json` and `/openapi/anything` when the reference is off.
   - The reference page gets its own policy when on.
   - The OpenAPI document gets the app policy.
5. `docs/threat-model.md` describes the behaviour.

**Acceptance:** every server response carries a `Content-Security-Policy` header, and the full server test suite is green.

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
| 1 | F1 reference-page CSP + tests + threat-model note (done) | Commit on `release-1.17.1`, `dotnet test` green in CI |
| 2 | F2 undici bump (or merge #46 first and rebase) | `npm audit` clean, web tests/build green |
| 3 | F3 pin actions to SHAs + Dependabot for actions | CI passes on the branch |
| 4 | Version bump 1.17.0 → 1.17.1 (`Directory.Build.props`, `Dockerfile`, `package.json`, lock file) + CHANGELOG "Security" entry | PR `release-1.17.1` → `main` |

After each phase: commit, push, and post a progress comment on the tracking issue. Merge to `main` only after approval.

**Estimated effort:**
- Phase 1: about 2 h
- Phases 2 and 3: under 1 h each
- Phase 4: about 30 min

**Risk:** low. F1 changes headers on only a few rarely used paths. F3 is mechanical.
