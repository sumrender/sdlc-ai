# Minimal opencode runner for every Sandbox. Provides node + Playwright browsers
# (via the base image), git, pnpm and opencode only. All other toolchains
# (dotnet, python, rust, bun, ...) come from the Project Manifest's `setup`
# commands, which run as root inside the workspace.
# Default (macOS/Linux): Alpine-linked opencode 2.0.8 via musl shims.
# Windows alternative (auto-selected on win32, see select-dockerfile.mjs): sandbox/Dockerfile.windows.
FROM mcr.microsoft.com/playwright:v1.62.1-noble

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

# opencode is a musl-linked Alpine binary; Ubuntu/glibc base needs the musl loader.
RUN apt-get update \
  && apt-get install -y --no-install-recommends musl \
  && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/anomalyco/opencode:2.0.8 /usr/local/bin/opencode /usr/local/bin/opencode
# musl-built C++ runtime to match the Alpine-linked opencode binary
# (Ubuntu's glibc-built libstdc++ is not loadable by the musl loader).
# Kept OUT of the default library search paths: previously these lived in
# /usr/lib and were exposed via LD_LIBRARY_PATH, which opencode's children
# (node, dotnet, Chrome — all glibc binaries) inherited, making them load the
# musl libstdc++ and fail to start.
COPY --from=ghcr.io/anomalyco/opencode:2.0.8 /usr/lib/libstdc++.so.6.0.34 /opt/opencode-libs/libstdc++.so.6
COPY --from=ghcr.io/anomalyco/opencode:2.0.8 /usr/lib/libgcc_s.so.1 /opt/opencode-libs/libgcc_s.so.1

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

ENV DOTNET_CLI_TELEMETRY_OPTOUT=1 \
    DOTNET_NOLOGO=1 \
    npm_config_cache=/cache/npm \
    NUGET_PACKAGES=/cache/nuget

# Scope the musl lib path to the opencode process only, via the loader's
# --library-path (never LD_LIBRARY_PATH, which every child process would
# inherit and use to resolve glibc binaries' libstdc++ to the musl build).
# The loader path is arch-dependent (x86_64/aarch64), so discover it at build time.
RUN LOADER="$(ls /lib/ld-musl-*.so.1 2>/dev/null | head -n1)" \
  && test -n "$LOADER" \
  && mv /usr/local/bin/opencode /usr/local/bin/opencode.bin \
  && printf '#!/bin/sh\nexec %s --library-path /opt/opencode-libs /usr/local/bin/opencode.bin "$@"\n' "$LOADER" > /usr/local/bin/opencode \
  && chmod +x /usr/local/bin/opencode

# Karma's ChromeHeadless: expose Playwright's Chromium (not on PATH) as
# CHROME_BIN through a wrapper that adds --no-sandbox (containers run as root),
# so tasks don't need to ship their own karma/chrome workaround files.
RUN CHROME="$(find /ms-playwright -type f -path '*/chrome-linux/chrome' | head -n1)" \
  && test -n "$CHROME" \
  && ln -sf "$CHROME" /opt/chrome \
  && printf '#!/bin/sh\nexec /opt/chrome --no-sandbox "$@"\n' > /usr/local/bin/chrome \
  && chmod +x /usr/local/bin/chrome
ENV CHROME_BIN=/usr/local/bin/chrome

WORKDIR /workspace
