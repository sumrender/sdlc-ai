# Minimal opencode runner for every Sandbox. Provides node + Playwright browsers
# (via the base image), git, pnpm and opencode only. All other toolchains
# (dotnet, python, rust, bun, ...) come from the Project Manifest's `setup`
# commands, which run as root inside the workspace.
# Default (macOS/Linux): the Alpine/musl opencode 2.0.8 binary, run directly via
# the musl loader (no wrapper script — see the ld-musl path note below).
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

# Point the *musl* loader at /opt/opencode-libs through its own search-path file
# (/etc/ld-musl-$ARCH.path). This is scoped exactly right: only musl-linked
# binaries (i.e. opencode) consult it, while glibc binaries — node, Chrome, and
# whatever the Manifest's setup installs — resolve through glibc's ld.so and are
# untouched. A global LD_LIBRARY_PATH would have made them load the musl
# libstdc++ and fail to start.
#
# Do NOT wrap opencode in a loader shim (`exec ld-musl-*.so.1 --library-path ...
# opencode.bin "$@"`). That works for `opencode --version` but breaks `opencode
# run`: the shim makes /proc/self/exe the loader, so opencode re-execs its own
# server as `ld-musl-aarch64.so.1 serve` and dies with
#   Error: Server process exited with code 1
#   /usr/lib/<arch>-linux-musl/libc.so: cannot load serve: No such file or directory
# The binary's PT_INTERP is already the musl loader, so it runs directly.
RUN set -eu; \
  ARCH="$(uname -m)"; \
  PATHFILE="/etc/ld-musl-${ARCH}.path"; \
  test -f "$PATHFILE" || printf '/lib/%s-linux-musl\n/usr/lib/%s-linux-musl\n' "$ARCH" "$ARCH" > "$PATHFILE"; \
  echo /opt/opencode-libs >> "$PATHFILE"; \
  # Debian reassembles $PATHFILE from this directory when musl is reconfigured.
  if [ -d "/etc/ld-musl-${ARCH}.d" ]; then echo /opt/opencode-libs > "/etc/ld-musl-${ARCH}.d/opencode.path"; fi; \
  # Guard the invariant above: opencode must stay a real ELF binary. `opencode
  # --version` passes even when wrapped, so check the file shape, not just the exit code.
  head -c 4 /usr/local/bin/opencode | od -An -c | grep -q 'E   L   F' \
    || { echo "FATAL: /usr/local/bin/opencode is not an ELF binary; a wrapper script breaks 'opencode run'" >&2; exit 1; }; \
  opencode --version

# Karma's ChromeHeadless: expose Playwright's Chromium (not on PATH) as
# CHROME_BIN through a wrapper that adds --no-sandbox (containers run as root),
# so tasks don't need to ship their own karma/chrome workaround files.
# The browser directory name is arch-dependent (chrome-linux, chrome-linux-arm64,
# ...), so glob instead of hardcoding, and skip chromium_headless_shell-* (it
# ships `headless_shell`, which Karma's ChromeHeadless launcher cannot drive).
# Fail the build loudly if no working Chrome is found: a missing or broken
# CHROME_BIN makes every project's frontend unit tests skip silently.
RUN set -eu; \
  CHROME=""; \
  for candidate in /ms-playwright/chromium-*/chrome-linux*/chrome; do \
    [ -x "$candidate" ] || continue; \
    CHROME="$candidate"; \
    break; \
  done; \
  if [ -z "$CHROME" ]; then \
    echo "FATAL: no Chromium at /ms-playwright/chromium-*/chrome-linux*/chrome" >&2; \
    ls -la /ms-playwright >&2 || true; \
    exit 1; \
  fi; \
  ln -sf "$CHROME" /opt/chrome; \
  printf '#!/bin/sh\nexec /opt/chrome --no-sandbox "$@"\n' > /usr/local/bin/chrome; \
  chmod +x /usr/local/bin/chrome; \
  echo "CHROME_BIN -> $CHROME"; \
  /usr/local/bin/chrome --version
ENV CHROME_BIN=/usr/local/bin/chrome

WORKDIR /workspace
