# Third-party licensing policy

Maple Notes is released under the PolyForm Noncommercial License 1.0.0. That license covers only the
code written for this project. Every third-party component stays under its own license, and we must
meet each one's conditions (usually: keep the copyright notice and license text).

This is engineering due diligence, not legal advice. Get a lawyer's review before any commercial or
high-stakes distribution.

## Rules

1. **Only permissive licenses ship in the product** (the published container image and the SPA bundle).
2. **Every dependency is checked before it is added**, including transitive ones, with
   `scripts/check-licenses.sh`. The script fails the build on anything outside the allowed list.
3. **Notices ship with the product.** `THIRD-PARTY-NOTICES.md` lists every shipped component with its
   license and copyright line, and is copied into the container image.
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

We do not ship code from Zetetic's SQLCipher project. SQLite3 Multiple Ciphers implements the same
on-disk format, so databases open with the official `sqlcipher` tool (verified in Phase 0 with
SQLCipher 4.5.6). "SQLCipher" is a trademark of Zetetic LLC; this project refers to it only to describe
file-format compatibility.

## Container image

The runtime image is based on Microsoft's .NET image built on Ubuntu. Its OS packages keep their own
licenses (some GPL/LGPL). Shipping them unmodified inside a base image is standard practice and does
not affect the license of Maple Notes' own code; their sources are available from Ubuntu. We prefer the
"chiseled" variant, which contains far fewer OS packages.

## Before public release

- Regenerate `THIRD-PARTY-NOTICES.md` from the exact dependency versions being released.
- Search trademark databases (for example USPTO, EUIPO, WIPO) for "Maple Notes" in software classes.
