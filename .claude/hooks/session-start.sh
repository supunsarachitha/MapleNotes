#!/bin/bash
# Prepares a Claude Code cloud session: the .NET SDK (which the container does not have), the server's NuGet packages
# and the web app's npm packages, so the build, the tests and the type check work at once (see CLAUDE.md).
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# .NET 10 SDK (global.json asks for 10.0.100 with rollForward: latestFeature), from Ubuntu's packages.
if ! command -v dotnet >/dev/null 2>&1 || ! dotnet --list-sdks | grep -q '^10\.'; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq dotnet-sdk-10.0 >/dev/null
fi

dotnet restore --verbosity quiet
dotnet tool restore >/dev/null

# npm install rather than npm ci, so the packages are reused from the cached container.
(cd src/maple-web && npm install --no-audit --no-fund --loglevel=error)
