# Third-party licensing policy

Maple Notes is released under the PolyForm Noncommercial License 1.0.0. That license covers only the
code written for this project. Every third-party component stays under its own license, and we must
meet each one's conditions (usually: keep the copyright notice and license text).

This is engineering due diligence, not legal advice. Get a lawyer's review before any commercial or
high-stakes distribution.

## Rules

1. **Only permissive licenses ship in the product** (the published container image and the SPA bundle).
2. **Every dependency is checked before it is added**, including transitive ones, with
   `python3 scripts/check-licenses.py`. It fails on any shipped dependency outside the allowed list and on
   any denied license anywhere.
3. **Notices ship with the product.** `THIRD-PARTY-NOTICES.md` lists every shipped component with its
   license text, and is copied into the container image at `/app/licenses/`. Regenerate it whenever dependencies
   change: `python3 scripts/check-licenses.py --notices THIRD-PARTY-NOTICES.md`. "Shipped" is taken from a Release
   publish's `deps.json` (exactly what goes into the image) and from the non-dev packages in `package-lock.json`.
4. **No code, text, logos or screenshots are copied from other projects**, including memos. Maple Notes
   is inspired by memos' feature set only.
5. **Third-party names are used only to describe compatibility**, never to imply endorsement.

## License categories

| Category | Licenses | Rule |
|---|---|---|
| Allowed | MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, 0BSD, Zlib, Unlicense, CC0-1.0, public domain, OFL-1.1 (fonts only) | Use freely; keep notices. Apache-2.0: also carry any `NOTICE` file. |
| Review first | MPL-2.0, LGPL, EPL, anything with a custom license file | Needs an explicit decision recorded in this file. |
| Not allowed | GPL, AGPL, SSPL, BUSL, Elastic, Commons Clause, "non-commercial" or "source-available" licenses, any license requiring payment for some users | Never added. |

## Known traps (avoided on purpose)

These popular .NET packages moved to commercial or restrictive terms and are **not** used:

| Package | Status | What we use instead |
|---|---|---|
| FluentAssertions 8+ | Commercial license (Xceed) | xUnit's built-in `Assert` |
| MediatR 13+, AutoMapper 15+ | Commercial dual license | Plain services and hand-written mapping |
| SixLabors.ImageSharp | Six Labors Split License | No server-side image processing in v1 |
| Duende IdentityServer | Commercial | ASP.NET Core cookie authentication |
| Official Zetetic SQLCipher builds for .NET | Commercial | SQLite3 Multiple Ciphers (see below) |

## Database encryption component

| Component | License | Role |
|---|---|---|
| SQLite | Public domain | Database engine |
| SQLite3 Multiple Ciphers (`SQLite3MC.PCLRaw.*`) | MIT | SQLite build with encryption; writes the SQLCipher v4 file format |
| SQLitePCLRaw | Apache-2.0 | .NET bindings for native SQLite |
| Microsoft.Data.Sqlite / EF Core | MIT | Data access |

The native `libsqlite3mc` binary compiles in code from other authors. Its source (v2.4.0) was audited
file by file on 2026-09-28; every file is MIT, BSD-3-Clause, CC0/Apache-2.0 or public domain:

| Embedded code | License | Notice obligation |
|---|---|---|
| SQLite3 Multiple Ciphers (Ulrich Telle) | MIT | Reproduce in `THIRD-PARTY-NOTICES.md` |
| AEGIS ciphers (Frank Denis) | MIT | Reproduce in `THIRD-PARTY-NOTICES.md` |
| miniz (Rich Geldreich, RAD Game Tools, Valve) | MIT | Reproduce in `THIRD-PARTY-NOTICES.md` |
| SHA-2 (Olivier Gay) | BSD-3-Clause | **Binary distribution must reproduce the notice** in documentation |
| Argon2 reference code | CC0-1.0 or Apache-2.0 (our choice: CC0) | None |
| fastpbkdf2, ChaCha20-Poly1305, Ascon, SHA-1, MD5, SQLite | Public domain / CC0 | None |

We do not ship code from Zetetic's SQLCipher project. SQLite3 Multiple Ciphers implements the same
on-disk format, so databases open with the official `sqlcipher` tool (verified in Phase 0 with
SQLCipher 4.5.6). "SQLCipher" is a trademark of Zetetic LLC; this project refers to it only to describe
file-format compatibility.

## Password-derivation component

Since v1.1.0 the browser derives sign-in and encryption keys from the password with Argon2id (see
[e2ee-spec.md](e2ee-spec.md)).

| Component | License | Role |
|---|---|---|
| hash-wasm 4.12.0 | MIT | Argon2id (and the BLAKE2b it builds on) compiled to WebAssembly; runs in a Web Worker |
| fflate 0.8.3 | MIT | Writes the export ZIP in the browser for end-to-end accounts; pure JavaScript, no embedded third-party code |

hash-wasm's license says its embedded C code may carry other permissive licenses. The two files compiled into the
modules we ship were read on 2026-09-29:

| Embedded code | License | Notice obligation |
|---|---|---|
| `src/argon2.c`, "based on" Go's `golang.org/x/crypto/argon2` | BSD-3-Clause (The Go Authors) | **Binary distribution must reproduce the notice**; done in `THIRD-PARTY-NOTICES.md` |
| `src/blake2b.c`, BLAKE2 reference code (Samuel Neves) | CC0-1.0, OpenSSL or Apache-2.0 (our choice: CC0) | None |

Embedded-code notices live in `scripts/notices/*-embedded.md` and are appended to `THIRD-PARTY-NOTICES.md`
automatically.

Development-only additions, which do not ship: `Konscious.Security.Cryptography.Argon2` (MIT; the test suite's
independent Argon2id) and `fake-indexeddb` (Apache-2.0; browser storage in unit tests).

## Reviewed exceptions

| Package | License | Scope | Decision |
|---|---|---|---|
| `lightningcss` (+ platform binaries) | MPL-2.0 | Build-time only | Accepted. Tailwind CSS and Vite run it to compile CSS; none of its code ships, only the CSS it produces. MPL-2.0 obligations apply to its own source files, which we neither modify nor distribute. |

## Brand assets

The Maple Notes icon (`src/maple-web/public/favicon.svg`) is original artwork drawn for this project: a
17-point sugar-maple leaf with rounded sinuses and a curved stem, coloured like an autumn leaf (red at the heart,
golden at the tips). It deliberately does not reproduce the Canadian flag's 11-point maple leaf, an official national
emblem whose use in marks is restricted in Canada. It is not taken from any icon library or emoji font: the colour
style was chosen to feel like the 🍁 emoji, but Apple's, Google's and others' emoji artwork is not copied. Keep new
brand assets original or under an allowed license.

## Container image

The runtime image is based on Microsoft's .NET image built on Ubuntu. Its OS packages keep their own
licenses (some GPL/LGPL). Shipping them unmodified inside a base image is standard practice and does
not affect the license of Maple Notes' own code; their sources are available from Ubuntu. We prefer the
"chiseled" variant, which contains far fewer OS packages.

## Before public release

- [x] Regenerate `THIRD-PARTY-NOTICES.md` from the exact dependency versions being released (done for 1.0.0, 1.1.0,
  1.2.0, 1.2.1 and 1.3.0).
- [ ] Put the copyright holder's legal name in the `Required Notice` line of `LICENSE`.
- [ ] Search trademark databases (for example USPTO, EUIPO, WIPO) for "Maple Notes" in software classes.
