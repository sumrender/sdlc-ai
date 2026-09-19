# Fixed runtime image for every Sandbox. The Project Manifest never selects images.
FROM mcr.microsoft.com/playwright:v1.62.1-noble

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates dotnet-sdk-8.0 \
  && rm -rf /var/lib/apt/lists/*

# The official OpenCode image is Alpine/musl and its binary does not run on this glibc base,
# so install the glibc build from the GitHub release instead.
ARG OPENCODE_VERSION=1.18.31
RUN curl -fsSL "https://github.com/anomalyco/opencode/releases/download/v${OPENCODE_VERSION}/opencode-linux-x64.tar.gz" \
  | tar -xz -C /usr/local/bin opencode \
  && chmod +x /usr/local/bin/opencode \
  && opencode --version

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

ENV DOTNET_CLI_TELEMETRY_OPTOUT=1 \
    DOTNET_NOLOGO=1 \
    npm_config_cache=/cache/npm \
    NUGET_PACKAGES=/cache/nuget

WORKDIR /workspace
