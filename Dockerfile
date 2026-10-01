# syntax=docker/dockerfile:1
#
# Maple Notes: single-container image (React SPA + ASP.NET Core API).
#
# Stages
#   web      Node.js builds the React SPA into static files.
#   build    .NET SDK restores and publishes the server for the target CPU architecture.
#   runtime  Chiseled Ubuntu with the ASP.NET Core runtime: no shell, no package manager, non-root user (UID 1654).
#
# Multi-architecture: the build stages run on the builder's native platform and cross-publish for $TARGETARCH,
# so `docker buildx build --platform linux/amd64,linux/arm64 .` works without emulating the SDK.

ARG DOTNET_VERSION=10.0
ARG NODE_VERSION=24

# ---------------------------------------------------------------------------------------------------------------------
FROM --platform=$BUILDPLATFORM node:${NODE_VERSION}-alpine AS web
WORKDIR /src
COPY src/maple-web/package.json src/maple-web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY src/maple-web/ ./
RUN npm run build

# ---------------------------------------------------------------------------------------------------------------------
FROM --platform=$BUILDPLATFORM mcr.microsoft.com/dotnet/sdk:${DOTNET_VERSION}-noble AS build
ARG TARGETARCH
WORKDIR /src

# Restore first, in its own layer, so package downloads are cached until a project file changes.
COPY global.json Directory.Build.props Directory.Packages.props .editorconfig ./
COPY src/MapleNotes.Server/MapleNotes.Server.csproj src/MapleNotes.Server/
RUN dotnet restore src/MapleNotes.Server/MapleNotes.Server.csproj -a $TARGETARCH -p:Configuration=Release

COPY src/MapleNotes.Server/ src/MapleNotes.Server/
RUN dotnet publish src/MapleNotes.Server/MapleNotes.Server.csproj \
        --configuration Release --arch $TARGETARCH --no-restore \
        --output /app -p:UseAppHost=false \
    && mkdir -p /data-template

# ---------------------------------------------------------------------------------------------------------------------
# "-extra" adds ICU and time-zone data, needed to export notes grouped by the user's local dates.
FROM mcr.microsoft.com/dotnet/aspnet:${DOTNET_VERSION}-noble-chiseled-extra AS runtime

LABEL org.opencontainers.image.title="Maple Notes" \
      org.opencontainers.image.description="Self-hosted micro-note taking, encrypted at rest or end to end" \
      org.opencontainers.image.version="1.7.0" \
      org.opencontainers.image.source="https://github.com/supunsarachitha/MapleNotes" \
      org.opencontainers.image.licenses="PolyForm-Noncommercial-1.0.0"

WORKDIR /app

# Application files stay root-owned (read-only for the app user); only the data directory is writable.
COPY --from=build /app ./
COPY --from=web /src/dist ./wwwroot
COPY --from=build --chown=1654:1654 /data-template /app/data

# License terms travel with the binaries (some third-party licenses require it).
COPY LICENSE THIRD-PARTY-NOTICES.md /app/licenses/

ENV ASPNETCORE_HTTP_PORTS=8080 \
    MAPLE_DATA_DIR=/app/data

USER 1654
EXPOSE 8080
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD ["dotnet", "/app/MapleNotes.Server.dll", "--healthcheck"]

ENTRYPOINT ["dotnet", "/app/MapleNotes.Server.dll"]
