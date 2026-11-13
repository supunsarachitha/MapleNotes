#!/usr/bin/env python3
"""Checks that a Maple Notes instance serves the genuine web app of a release.

Every release on GitHub carries build-manifest.json, the SHA-256 hash of each file of the built web app, signed by the
repository's CI (check the signature with cosign, see "Checking the web app" in the README). This script downloads
every file in that manifest from the instance and compares the hashes. It runs outside the browser, so a server that
changes the app cannot change the result, unlike the in-app check in Settings → About.

    python3 scripts/verify-instance.py https://notes.example.com
    python3 scripts/verify-instance.py https://notes.example.com --manifest build-manifest.json

Without --manifest, the script reads the version the instance claims (its /build-manifest.json) and downloads that
release's manifest from GitHub. Exit status: 0 when every file matches, 1 when any differs or is missing, 2 when the
check could not run. Standard library only.
"""

import argparse
import hashlib
import json
import sys
import urllib.error
import urllib.parse
import urllib.request

RELEASE_URL = "https://github.com/supunsarachitha/MapleNotes/releases/download/v{version}/build-manifest.json"
USER_AGENT = "maple-notes-verify-instance/1"


def fetch(url):
    # No Accept-Encoding header, so a reverse proxy sends the bytes as stored rather than compressed.
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Cache-Control": "no-cache"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read()


def load_manifest(data, source):
    manifest = json.loads(data)
    if (
        not isinstance(manifest, dict)
        or manifest.get("app") != "maple-notes"
        or manifest.get("algorithm") != "sha256"
        or not isinstance(manifest.get("files"), dict)
    ):
        raise ValueError(f"{source} is not a Maple Notes build manifest")
    return manifest


def verify(base_url, release):
    """Returns one line per file that differs, is missing, or is listed by the instance but not by the release."""
    base = base_url.rstrip("/") + "/"
    problems = []
    for path, expected in sorted(release["files"].items()):
        url = urllib.parse.urljoin(base, path.lstrip("/"))
        try:
            actual = hashlib.sha256(fetch(url)).hexdigest()
        except urllib.error.HTTPError as error:
            problems.append(f"MISSING  {path} (HTTP {error.code})")
            continue
        if actual != expected:
            problems.append(f"CHANGED  {path}")
    try:
        served = load_manifest(fetch(urllib.parse.urljoin(base, "build-manifest.json")), "the instance's manifest")
        for path in sorted(set(served["files"]) - set(release["files"])):
            problems.append(f"EXTRA    {path} (listed by the instance, not in the release)")
    except (urllib.error.HTTPError, ValueError) as error:
        problems.append(f"MANIFEST the instance's /build-manifest.json could not be read ({error})")
    return problems


def main(argv=None):
    parser = argparse.ArgumentParser(description="Compare an instance's web app with a release's build manifest.")
    parser.add_argument("url", help="the instance's address, e.g. https://notes.example.com")
    parser.add_argument("--manifest", help="a release manifest file (default: download the instance's version from GitHub)")
    args = parser.parse_args(argv)
    base = args.url.rstrip("/") + "/"

    try:
        if args.manifest:
            with open(args.manifest, "rb") as file:
                release = load_manifest(file.read(), args.manifest)
        else:
            served = load_manifest(fetch(urllib.parse.urljoin(base, "build-manifest.json")), "the instance's manifest")
            url = RELEASE_URL.format(version=urllib.parse.quote(str(served.get("version", ""))))
            print(f"The instance says it runs {served.get('version')}; release manifest: {url}")
            release = load_manifest(fetch(url), url)
        problems = verify(args.url, release)
    except (OSError, ValueError) as error:
        print(f"Could not run the check: {error}", file=sys.stderr)
        return 2

    for line in problems:
        print(line)
    checked = len(release["files"])
    if problems:
        print(f"FAILED: {len(problems)} problem(s) among {checked} files of release {release.get('version')}.")
        return 1
    print(f"OK: all {checked} files match release {release.get('version')}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
