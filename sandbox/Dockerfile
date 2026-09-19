# Fixed runtime image for every Sandbox. The Project Manifest never selects images.
FROM mcr.microsoft.com/playwright:v1.62.1-noble

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates dotnet-sdk-8.0 \
  && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/anomalyco/opencode:2.0.8 /usr/local/bin/opencode /usr/local/bin/opencode

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

ENV DOTNET_CLI_TELEMETRY_OPTOUT=1 \
    DOTNET_NOLOGO=1 \
    npm_config_cache=/cache/npm \
    NUGET_PACKAGES=/cache/nuget

WORKDIR /workspace
