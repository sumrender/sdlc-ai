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
COPY --from=ghcr.io/anomalyco/opencode:2.0.8 /usr/lib/libstdc++.so.6.0.34 /usr/lib/libstdc++.so.6.0.34
COPY --from=ghcr.io/anomalyco/opencode:2.0.8 /usr/lib/libgcc_s.so.1 /usr/lib/libgcc_s.so.1
RUN ln -sf libstdc++.so.6.0.34 /usr/lib/libstdc++.so.6

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

ENV DOTNET_CLI_TELEMETRY_OPTOUT=1 \
    DOTNET_NOLOGO=1 \
    npm_config_cache=/cache/npm \
    NUGET_PACKAGES=/cache/nuget

# Scope the musl lib path to opencode only: a global LD_LIBRARY_PATH would make
# glibc binaries (node and anything the manifest installs, e.g. dotnet) pick up
# the Alpine libstdc++ and fail to start.
RUN mv /usr/local/bin/opencode /usr/local/bin/opencode.bin \
  && printf '#!/bin/sh\nexec env LD_LIBRARY_PATH=/usr/lib:/lib /usr/local/bin/opencode.bin "$@"\n' > /usr/local/bin/opencode \
  && chmod +x /usr/local/bin/opencode

WORKDIR /workspace
