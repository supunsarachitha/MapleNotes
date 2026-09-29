#!/usr/bin/env python3
"""Check every NuGet and npm dependency (including transitive ones) against the license policy.

Policy: docs/licensing.md. Exit code 1 when:
  * a shipped dependency (server runtime NuGet packages, npm production packages) is not on the allow list, or
  * any dependency, shipped or build-time, uses a denied license.
Build-time dependencies with an unknown license only produce a warning.

Usage:
  python3 scripts/check-licenses.py            # summary + problems
  python3 scripts/check-licenses.py --all      # also list every package
Requires: .NET SDK (packages restored) and `npm install` in src/maple-web.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SERVER_PROJECT = ROOT / "src/MapleNotes.Server/MapleNotes.Server.csproj"
TEST_PROJECTS = [ROOT / "tests/MapleNotes.Server.Tests/MapleNotes.Server.Tests.csproj"]
WEB_DIR = ROOT / "src/maple-web"

ALLOWED = {
    "MIT", "MIT-0", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "0BSD", "Zlib",
    "Unlicense", "CC0-1.0", "BlueOak-1.0.0", "Python-2.0", "PSF-2.0", "CC-BY-4.0",
}
# Substrings that mark a license as never acceptable, shipped or not.
DENIED_PATTERNS = ("GPL", "SSPL", "BUSL", "Elastic", "Commons-Clause", "NonCommercial", "PolyForm", "CC-BY-NC")

# Packages whose metadata points at a URL or file rather than an SPDX expression, resolved after manual review.
# Format: package id (lower case) -> (SPDX id, reason / where it was verified).
REVIEWED = {
    # Example: "some.package": ("MIT", "LICENSE file checked 2026-09-28"),
}
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


@dataclass
class Package:
    ecosystem: str
    name: str
    version: str
    license: str
    shipped: bool


def spdx_verdict(expression: str) -> str:
    """Return 'allowed', 'denied' or 'unknown' for an SPDX expression such as '(MIT OR Apache-2.0)'."""
    if not expression:
        return "unknown"
    # "LGPL-2.1 OR MIT" is fine because we can pick MIT, so deny only when no OR-branch is allowed.
    cleaned = expression.replace("(", " ").replace(")", " ")
    branches = [b.strip() for b in re.split(r"\s+OR\s+", cleaned)]
    verdicts = []
    for branch in branches:
        terms = [t.strip() for t in re.split(r"\s+AND\s+", branch) if t.strip()]
        terms = [re.sub(r"\s+WITH\s+.*$", "", t) for t in terms]
        if terms and all(t in ALLOWED for t in terms):
            return "allowed"
        if any(any(p.lower() in t.lower() for p in DENIED_PATTERNS) for t in terms):
            verdicts.append("denied")
        else:
            verdicts.append("unknown")
    return "denied" if verdicts and all(v == "denied" for v in verdicts) else "unknown"


def nuget_root() -> Path:
    return Path(os.environ.get("NUGET_PACKAGES", Path.home() / ".nuget/packages"))


def nuspec_license(package_id: str, version: str) -> str:
    reviewed = REVIEWED.get(package_id.lower())
    if reviewed:
        return reviewed[0]
    folder = nuget_root() / package_id.lower() / version.lower()
    nuspecs = list(folder.glob("*.nuspec"))
    if not nuspecs:
        return f"<nuspec not found in {folder}>"
    tree = ET.parse(nuspecs[0])
    license_el = license_url = None
    for el in tree.iter():
        tag = el.tag.split("}")[-1]
        if tag == "license":
            license_el = el
        elif tag == "licenseUrl":
            license_url = (el.text or "").strip()
    if license_el is not None:
        if license_el.get("type") == "expression":
            return (license_el.text or "").strip()
        return f"<license file: {(license_el.text or '').strip()}>"
    if license_url:
        return KNOWN_LICENSE_URLS.get(license_url, f"<license url: {license_url}>")
    return "<no license metadata>"


def nuget_packages(project: Path, shipped: bool) -> list[Package]:
    output = subprocess.run(
        ["dotnet", "list", str(project), "package", "--include-transitive", "--format", "json"],
        check=True, capture_output=True, text=True,
    ).stdout
    data = json.loads(output)
    found: dict[tuple[str, str], Package] = {}
    for proj in data.get("projects", []):
        for framework in proj.get("frameworks", []):
            for pkg in framework.get("topLevelPackages", []) + framework.get("transitivePackages", []):
                key = (pkg["id"], pkg["resolvedVersion"])
                if key not in found:
                    found[key] = Package("nuget", pkg["id"], pkg["resolvedVersion"],
                                         nuspec_license(pkg["id"], pkg["resolvedVersion"]), shipped)
    return list(found.values())


def npm_packages() -> list[Package]:
    lock = json.loads((WEB_DIR / "package-lock.json").read_text())
    result = []
    for path, meta in lock.get("packages", {}).items():
        if not path:
            continue  # the root project itself
        name = path.split("node_modules/")[-1]
        license_value = meta.get("license")
        if not license_value:
            manifest = WEB_DIR / path / "package.json"
            if manifest.exists():
                license_value = json.loads(manifest.read_text()).get("license")
        if isinstance(license_value, dict):
            license_value = license_value.get("type")
        shipped = not (meta.get("dev") or meta.get("devOptional"))
        result.append(Package("npm", name, meta.get("version", "?"), license_value or "<no license metadata>", shipped))
    return result


def main() -> int:
    show_all = "--all" in sys.argv
    packages = nuget_packages(SERVER_PROJECT, shipped=True)
    shipped_ids = {(p.name, p.version) for p in packages}
    for test_project in TEST_PROJECTS:
        packages += [p for p in nuget_packages(test_project, shipped=False) if (p.name, p.version) not in shipped_ids]
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
    return 0


if __name__ == "__main__":
    sys.exit(main())
