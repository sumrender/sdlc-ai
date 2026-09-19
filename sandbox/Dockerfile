FROM mcr.microsoft.com/playwright:v1.62.1-noble

COPY --from=ghcr.io/anomalyco/opencode:2.0.8 /usr/local/bin/opencode /usr/local/bin/opencode

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /workspace
