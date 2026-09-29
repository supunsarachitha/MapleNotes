#!/usr/bin/env python3
"""Check every NuGet and npm dependency (including transitive ones) against the license policy, and generate
THIRD-PARTY-NOTICES.md.

Policy: docs/licensing.md. Exit code 1 when:
  * a shipped dependency is not on the allow list, or
  * any dependency, shipped or build-time, uses a denied license.
Build-time dependencies with an unknown license only produce a warning.

"Shipped" is determined exactly: NuGet packages listed in a Release publish's deps.json (what goes into the
container image), and npm packages that are not dev-only in package-lock.json (what can end up in the web bundle).

Usage:
  python3 scripts/check-licenses.py                                  # summary + problems
  python3 scripts/check-licenses.py --all                            # also list every package
  python3 scripts/check-licenses.py --notices THIRD-PARTY-NOTICES.md # also write the notices file
Requires: .NET SDK, and `npm ci` in src/maple-web.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SERVER_PROJECT = ROOT / "src/MapleNotes.Server/MapleNotes.Server.csproj"
BUILD_TIME_PROJECTS = [SERVER_PROJECT, ROOT / "tests/MapleNotes.Server.Tests/MapleNotes.Server.Tests.csproj"]
WEB_DIR = ROOT / "src/maple-web"
NOTICES_DIR = ROOT / "scripts/notices"

ALLOWED = {
    "MIT", "MIT-0", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "0BSD", "Zlib",
    "Unlicense", "CC0-1.0", "BlueOak-1.0.0", "Python-2.0", "PSF-2.0", "CC-BY-4.0",
}
# Substrings that mark a license as never acceptable, shipped or not.
DENIED_PATTERNS = ("GPL", "SSPL", "BUSL", "Elastic", "Commons-Clause", "NonCommercial", "PolyForm", "CC-BY-NC")

# Packages whose metadata points at a URL or file rather than an SPDX expression, resolved after manual review.
# Format: package id (lower case) -> (SPDX id, reason / where it was verified).
REVIEWED: dict[str, tuple[str, str]] = {}
# Build-time-only packages accepted after review (matched by name prefix). Still a failure if ever shipped.
ACCEPTED_BUILD_TIME = {
    "lightningcss": "MPL-2.0 CSS compiler run by Tailwind/Vite during the build; only its output ships",
}
KNOWN_LICENSE_URLS = {
    "https://licenses.nuget.org/MIT": "MIT",
    "https://github.com/dotnet/corefx/blob/master/LICENSE.TXT": "MIT",
    "https://github.com/dotnet/core-setup/blob/master/LICENSE.TXT": "MIT",
    "https://github.com/dotnet/standard/blob/master/LICENSE.TXT": "MIT",
    "https://raw.githubusercontent.com/xunit/xunit/master/license.txt": "Apache-2.0",
}

MIT_TEMPLATE = """MIT License

{copyright}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE."""


@dataclass
class Package:
    ecosystem: str
    name: str
    version: str
    license: str
    shipped: bool
    url: str = ""
    license_text: str = ""


def spdx_verdict(expression: str) -> str:
    """Return 'allowed', 'denied' or 'unknown' for an SPDX expression such as '(MIT OR Apache-2.0)'."""
    if not expression:
        return "unknown"
    # "LGPL-2.1 OR MIT" is fine because we can pick MIT, so deny only when no OR-branch is allowed.
    cleaned = expression.replace("(", " ").replace(")", " ")
    branches = [b.strip() for b in re.split(r"\s+OR\s+", cleaned)]
    verdicts = []
    for branch in branches:
        terms = [re.sub(r"\s+WITH\s+.*$", "", t.strip()) for t in re.split(r"\s+AND\s+", branch) if t.strip()]
        if terms and all(t in ALLOWED for t in terms):
            return "allowed"
        verdicts.append("denied" if any(any(p.lower() in t.lower() for p in DENIED_PATTERNS) for t in terms) else "unknown")
    return "denied" if verdicts and all(v == "denied" for v in verdicts) else "unknown"


# ---------------------------------------------------------------------------------------------------------- NuGet

def nuget_root() -> Path:
    return Path(os.environ.get("NUGET_PACKAGES", Path.home() / ".nuget/packages"))


def nuspec_metadata(package_id: str, version: str) -> tuple[str, str, str]:
    """(license, project url, copyright) from the package's nuspec."""
    reviewed = REVIEWED.get(package_id.lower())
    folder = nuget_root() / package_id.lower() / version.lower()
    nuspecs = list(folder.glob("*.nuspec"))
    if not nuspecs:
        return (reviewed[0] if reviewed else f"<nuspec not found in {folder}>", "", "")
    fields: dict[str, str] = {}
    license_type = ""
    for el in ET.parse(nuspecs[0]).iter():
        tag = el.tag.split("}")[-1]
        if tag in ("license", "licenseUrl", "projectUrl", "copyright", "authors") and tag not in fields:
            fields[tag] = (el.text or "").strip()
            if tag == "license":
                license_type = el.get("type", "")
        elif tag == "repository" and "repository" not in fields:
            fields["repository"] = el.get("url", "")
    if reviewed:
        license_value = reviewed[0]
    elif "license" in fields:
        license_value = fields["license"] if license_type == "expression" else f"<license file: {fields['license']}>"
    elif "licenseUrl" in fields:
        license_value = KNOWN_LICENSE_URLS.get(fields["licenseUrl"], f"<license url: {fields['licenseUrl']}>")
    else:
        license_value = "<no license metadata>"
    url = fields.get("projectUrl") or fields.get("repository", "")
    copyright_line = fields.get("copyright") or (f"Copyright (c) {fields['authors']}" if fields.get("authors") else "")
    return license_value, url, copyright_line


def shipped_nuget_packages() -> list[Package]:
    """Exactly the packages in a Release publish (what the container image contains)."""
    with tempfile.TemporaryDirectory() as out:
        subprocess.run(
            ["dotnet", "publish", str(SERVER_PROJECT), "-c", "Release", "-o", out, "-p:UseAppHost=false", "--nologo", "-v", "q"],
            check=True, capture_output=True, text=True,
        )
        deps = json.loads((Path(out) / "MapleNotes.Server.deps.json").read_text())
    packages = []
    for key, library in deps["libraries"].items():
        if library.get("type") != "package":
            continue
        name, version = key.split("/", 1)
        license_value, url, copyright_line = nuspec_metadata(name, version)
        packages.append(Package("nuget", name, version, license_value, True, url, license_text_for(license_value, copyright_line)))
    return packages


def build_time_nuget_packages(shipped: set[tuple[str, str]]) -> list[Package]:
    # Restore the default (Debug) graph again, since the Release publish above re-restored the server project.
    subprocess.run(["dotnet", "restore", str(ROOT / "MapleNotes.slnx"), "-v", "q"], check=True, capture_output=True, text=True)
    found: dict[tuple[str, str], Package] = {}
    for project in BUILD_TIME_PROJECTS:
        output = subprocess.run(
            ["dotnet", "list", str(project), "package", "--include-transitive", "--format", "json"],
            check=True, capture_output=True, text=True,
        ).stdout
        for proj in json.loads(output).get("projects", []):
            for framework in proj.get("frameworks", []):
                for pkg in framework.get("topLevelPackages", []) + framework.get("transitivePackages", []):
                    key = (pkg["id"], pkg["resolvedVersion"])
                    if key not in shipped and key not in found:
                        license_value, url, _ = nuspec_metadata(*key)
                        found[key] = Package("nuget", key[0], key[1], license_value, False, url)
    return list(found.values())


def license_text_for(license_value: str, copyright_line: str) -> str:
    if license_value == "MIT":
        return MIT_TEMPLATE.format(copyright=copyright_line or "Copyright (c) the package authors")
    if license_value == "Apache-2.0":
        return "__APACHE__"  # the full Apache-2.0 text is included once, see write_notices
    return ""


# ------------------------------------------------------------------------------------------------------------ npm

def npm_packages() -> list[Package]:
    lock = json.loads((WEB_DIR / "package-lock.json").read_text())
    result = []
    for path, meta in lock.get("packages", {}).items():
        if not path:
            continue  # the root project itself
        name = path.split("node_modules/")[-1]
        folder = WEB_DIR / path
        manifest = json.loads((folder / "package.json").read_text()) if (folder / "package.json").exists() else {}
        license_value = meta.get("license") or manifest.get("license")
        if isinstance(license_value, dict):
            license_value = license_value.get("type")
        repository = manifest.get("repository")
        url = repository.get("url", "") if isinstance(repository, dict) else (repository or manifest.get("homepage", ""))
        url = re.sub(r"^git\+|\.git$", "", url or "").replace("git://", "https://")
        text = ""
        for candidate in sorted(folder.glob("*")) if folder.exists() else []:
            if re.match(r"^(licen[sc]e|copying)(\.(md|txt|markdown))?$", candidate.name, re.IGNORECASE):
                text = candidate.read_text(errors="replace").strip()
                break
        shipped = not (meta.get("dev") or meta.get("devOptional"))
        result.append(Package("npm", name, meta.get("version", "?"), license_value or "<no license metadata>", shipped, url, text))
    return result


# -------------------------------------------------------------------------------------------------------- notices

def write_notices(path: Path, packages: list[Package]) -> None:
    shipped = sorted((p for p in packages if p.shipped), key=lambda p: (p.ecosystem, p.name.lower()))
    lines = [
        "# Third-party notices",
        "",
        "Maple Notes is licensed under the PolyForm Noncommercial License 1.0.0 (see `LICENSE`). It includes the",
        "third-party components below, each under its own license, reproduced in this file. This file is generated by",
        "`python3 scripts/check-licenses.py --notices THIRD-PARTY-NOTICES.md` from the exact dependency versions that",
        "ship in the container image and the web bundle.",
        "",
        "The container image is based on Microsoft's ASP.NET Core runtime image, which carries the .NET runtime's own",
        "notices (MIT) and the licenses of its Ubuntu packages inside the image.",
        "",
        "## Components",
        "",
        "| Component | Version | License | Source |",
        "|---|---|---|---|",
    ]
    for p in shipped:
        source = f"<{p.url}>" if p.url.startswith("http") else ""
        lines.append(f"| {p.name} ({p.ecosystem}) | {p.version} | {p.license} | {source} |")

    lines += ["", "## License texts", ""]
    groups: dict[str, list[Package]] = defaultdict(list)
    for p in shipped:
        text = p.license_text or MIT_TEMPLATE.format(copyright="Copyright (c) the package authors") if p.license == "MIT" else p.license_text
        groups[text or f"__SPDX__{p.license}"].append(p)
    apache = (NOTICES_DIR / "Apache-2.0.txt").read_text().strip()
    for text, members in sorted(groups.items(), key=lambda item: item[1][0].name.lower()):
        names = ", ".join(f"{m.name} {m.version}" for m in members)
        lines += [f"### {names}", ""]
        if text == "__APACHE__":
            lines += ["Licensed under the Apache License, Version 2.0; full text in the next section.", ""]
            continue
        if text.startswith("__SPDX__"):
            lines += [f"Licensed under {text[8:]}.", ""]
            continue
        lines += ["```text", text, "```", ""]

    lines += ["## Apache License 2.0", "", "```text", apache, "```", ""]
    lines += [(NOTICES_DIR / "sqlite3mc-embedded.md").read_text().strip(), ""]
    path.write_text("\n".join(lines))
    print(f"Wrote {path} ({len(shipped)} shipped components).")


# ----------------------------------------------------------------------------------------------------------- main

def main() -> int:
    show_all = "--all" in sys.argv
    notices_path = Path(sys.argv[sys.argv.index("--notices") + 1]) if "--notices" in sys.argv else None

    packages = shipped_nuget_packages()
    packages += build_time_nuget_packages({(p.name, p.version) for p in packages})
    packages += npm_packages()

    failures, warnings = [], []
    for pkg in sorted(packages, key=lambda p: (p.ecosystem, not p.shipped, p.name.lower())):
        verdict = spdx_verdict(pkg.license)
        if verdict == "unknown" and not pkg.shipped and any(pkg.name.startswith(p) for p in ACCEPTED_BUILD_TIME):
            verdict = "allowed"
        scope = "shipped" if pkg.shipped else "build-time"
        line = f"{pkg.ecosystem:5} {scope:10} {pkg.name} {pkg.version}: {pkg.license}"
        if verdict == "denied" or (verdict != "allowed" and pkg.shipped):
            failures.append(line)
        elif verdict != "allowed":
            warnings.append(line)
        if show_all:
            print(f"[{verdict:7}] {line}")

    shipped_count = sum(p.shipped for p in packages)
    print(f"Checked {len(packages)} packages ({shipped_count} shipped, {len(packages) - shipped_count} build-time).")
    for line in warnings:
        print(f"WARN  {line}")
    for line in failures:
        print(f"FAIL  {line}")
    if failures:
        print("License check failed. See docs/licensing.md; record reviewed exceptions in REVIEWED.")
        return 1
    print("License check passed.")
    if notices_path:
        write_notices(notices_path, packages)
    return 0


if __name__ == "__main__":
    sys.exit(main())
