#!/usr/bin/env python3
"""Refresh the digests of the base images pinned in the Dockerfile.

Each `FROM` line names an image as `name:tag@sha256:digest`. The tag says which release line we follow; the digest
fixes the exact image, so a tag that is re-pushed upstream cannot change a build without a commit. This script asks
each registry for the tag's current multi-architecture index digest and rewrites the line when it moved.

    python3 scripts/refresh-base-images.py           # update the Dockerfile in place
    python3 scripts/refresh-base-images.py --check   # only report; exit 1 when a digest is out of date

Supports Docker Hub (official images such as `node`) and mcr.microsoft.com, the two registries the Dockerfile uses.
"""

import json
import re
import sys
import urllib.request
from pathlib import Path

DOCKERFILE = Path(__file__).resolve().parent.parent / "Dockerfile"
FROM_LINE = re.compile(r"^(FROM\s+(?:--platform=\S+\s+)?)(\S+?):([^\s@]+)@(sha256:[0-9a-f]{64})(\s.*)?$")
ACCEPT = ", ".join(
    [
        "application/vnd.oci.image.index.v1+json",
        "application/vnd.docker.distribution.manifest.list.v2+json",
        "application/vnd.oci.image.manifest.v1+json",
        "application/vnd.docker.distribution.manifest.v2+json",
    ]
)


def registry_for(name):
    """Return (registry host, repository path, bearer token or None) for an image name."""
    first, _, rest = name.partition("/")
    if "." in first and rest:
        return first, rest, None
    repository = name if "/" in name else f"library/{name}"
    url = f"https://auth.docker.io/token?service=registry.docker.io&scope=repository:{repository}:pull"
    with urllib.request.urlopen(url, timeout=30) as response:
        token = json.load(response)["token"]
    return "registry-1.docker.io", repository, token


def current_digest(name, tag):
    host, repository, token = registry_for(name)
    request = urllib.request.Request(f"https://{host}/v2/{repository}/manifests/{tag}", method="HEAD")
    request.add_header("Accept", ACCEPT)
    if token:
        request.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(request, timeout=30) as response:
        digest = response.headers.get("Docker-Content-Digest")
    if not digest or not digest.startswith("sha256:"):
        raise RuntimeError(f"{host} returned no digest for {name}:{tag}")
    return digest


def main():
    check_only = "--check" in sys.argv[1:]
    lines = DOCKERFILE.read_text().splitlines(keepends=True)
    stale = 0
    pinned = 0
    for index, line in enumerate(lines):
        match = FROM_LINE.match(line.rstrip("\n"))
        if not match:
            if line.startswith("FROM ") and " AS " in line and "@sha256:" not in line:
                print(f"not pinned by digest: {line.strip()}")
                stale += 1
            continue
        pinned += 1
        prefix, name, tag, digest, suffix = match.groups()
        latest = current_digest(name, tag)
        if latest == digest:
            print(f"up to date: {name}:{tag}")
            continue
        stale += 1
        print(f"{'out of date' if check_only else 'updated'}: {name}:{tag} {digest[:19]}… → {latest[:19]}…")
        lines[index] = f"{prefix}{name}:{tag}@{latest}{suffix or ''}\n"
    if pinned == 0:
        print("no pinned FROM lines found", file=sys.stderr)
        return 2
    if check_only:
        return 1 if stale else 0
    DOCKERFILE.write_text("".join(lines))
    return 0


if __name__ == "__main__":
    sys.exit(main())
