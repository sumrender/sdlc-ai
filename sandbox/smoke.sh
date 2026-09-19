#!/usr/bin/env bash
# Manual smoke test for the Sandbox runtime image. Run once after building the image and
# whenever the Dockerfile changes:
#
#   ANTHROPIC_API_KEY=... sandbox/smoke.sh
#
# Builds the image, starts a Sandbox, clones the Project, runs a trivial command, runs a
# trivial `opencode run --format json` (skipped without ANTHROPIC_API_KEY), and copies a
# file out.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
IMAGE="${SANDBOX_IMAGE:-sdlc-ai-sandbox:local}"
REPO="${SMOKE_REPO:-https://github.com/${GITHUB_OWNER:-sumrender}/${GITHUB_REPO:-meme}.git}"
MODEL="${MODEL_FAST:-claude-haiku-4-5-20251001}"
NAME="sdlc-smoke-$$"

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "==> building $IMAGE"
docker build -t "$IMAGE" "$HERE"

echo "==> starting sandbox $NAME"
docker run -d --rm --name "$NAME" \
  -v sdlc-ai-cache:/cache \
  -v sdlc-ai-opencode:/root/.local/share/opencode \
  -w /workspace "$IMAGE" sleep infinity >/dev/null

echo "==> toolchain"
docker exec "$NAME" bash -c 'git --version && node --version && dotnet --version && opencode --version'

echo "==> cloning $REPO"
docker exec "$NAME" git clone --quiet --depth 1 "$REPO" /workspace

echo "==> trivial command"
docker exec -w /workspace "$NAME" bash -c 'ls -1 | head -20 && echo smoke-ok > /workspace/smoke.txt'

if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
  echo "==> trivial opencode run (model anthropic/$MODEL)"
  echo 'Reply with exactly the text SMOKE_OK and nothing else.' \
    | docker exec -i -w /workspace -e ANTHROPIC_API_KEY "$NAME" \
        opencode run --format json --model "anthropic/$MODEL" --auto \
    | tee /dev/stderr | grep -q 'SMOKE_OK'
else
  echo "==> ANTHROPIC_API_KEY not set; skipping opencode run"
fi

echo "==> copying a file out"
OUT="$(mktemp -d)"
docker cp "$NAME:/workspace/smoke.txt" "$OUT/"
test "$(cat "$OUT/smoke.txt")" = "smoke-ok"
rm -rf "$OUT"

echo "smoke passed"
