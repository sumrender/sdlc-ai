#!/usr/bin/env bash
# Manual smoke test for the Sandbox runtime image. Run once after building the image and
# whenever the Dockerfile changes:
#
#   GITHUB_TOKEN=... OPENCODE_API_KEY=... sandbox/smoke.sh
# (GITHUB_TOKEN is required for private repos; mirrors the API's auth-header clone)
#
# Builds the image, starts a Sandbox, clones the Project, runs a trivial command, runs a
# trivial `opencode run --format json` (skipped without OPENCODE_API_KEY), and copies a
# file out.
set -euo pipefail

# Git Bash on Windows rewrites arguments that look like POSIX paths (e.g. -w /workspace); disable that.
export MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*'

HERE="$(cd "$(dirname "$0")" && (pwd -W 2>/dev/null || pwd))"
IMAGE="${SANDBOX_IMAGE:-sdlc-ai-sandbox:local}"
# Auto-pick the Dockerfile variant for the host OS; explicit DOCKERFILE wins.
if [ -z "${DOCKERFILE:-}" ]; then DOCKERFILE="$(node "$HERE/select-dockerfile.mjs")"; fi
REPO="${SMOKE_REPO:-https://github.com/${GITHUB_OWNER:-sumrender}/${GITHUB_REPO:-meme}.git}"
MODEL="${MODEL_FAST:-muse-spark-1.3-contributor-free}"
NAME="sdlc-smoke-$$"

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "==> building $IMAGE"
# Via build.mjs so the image gets the sdlc.dockerfile-sha stamp the API uses to detect staleness.
DOCKERFILE="$DOCKERFILE" SANDBOX_IMAGE="$IMAGE" node "$HERE/build.mjs"

echo "==> starting sandbox $NAME"
docker run -d --rm --name "$NAME" \
  -v sdlc-ai-cache:/cache \
  -v sdlc-ai-opencode:/root/.local/share/opencode \
  -w /workspace "$IMAGE" sleep infinity >/dev/null

echo "==> toolchain (image provides git/node/pnpm/opencode only; other runtimes come from the manifest setup)"
docker exec "$NAME" bash -c 'git --version && node --version && pnpm --version && opencode --version'

# CHROME_BIN is what makes Karma's `ng test --browsers=ChromeHeadless` work in the Sandbox.
# When it is missing the pipeline only logs "skipped (runner missing)", so assert it here.
echo "==> CHROME_BIN (Karma ChromeHeadless)"
docker exec "$NAME" bash -c '
  set -eu
  test -n "${CHROME_BIN:-}" || { echo "CHROME_BIN is empty" >&2; exit 1; }
  test -x "$CHROME_BIN" || { echo "CHROME_BIN=$CHROME_BIN is not executable" >&2; exit 1; }
  echo "CHROME_BIN=$CHROME_BIN -> $(readlink -f /opt/chrome)"
  "$CHROME_BIN" --version | grep -Eiq "chrom(e|ium) [0-9]+\." || { echo "$CHROME_BIN --version did not report a Chrome version" >&2; exit 1; }
  "$CHROME_BIN" --version
'

echo "==> image build stamp (staleness detection)"
docker image inspect --format '{{index .Config.Labels "sdlc.dockerfile-sha"}}' "$IMAGE" \
  | grep -Eq '^[0-9a-f]{64}$' || { echo "image $IMAGE is missing the sdlc.dockerfile-sha label" >&2; exit 1; }

echo "==> cloning $REPO"
if [ -n "${GITHUB_TOKEN:-}" ]; then
  AUTH_HEADER="AUTHORIZATION: basic $(printf 'x-access-token:%s' "$GITHUB_TOKEN" | base64 | tr -d '\n')"
  docker exec "$NAME" git -c "http.extraheader=$AUTH_HEADER" clone --quiet --depth 1 "$REPO" /workspace
else
  docker exec "$NAME" git clone --quiet --depth 1 "$REPO" /workspace
fi

echo "==> trivial command"
docker exec -w /workspace "$NAME" bash -c 'ls -1 | head -20 && echo smoke-ok > /workspace/smoke.txt'

if [ -n "${OPENCODE_API_KEY:-}" ]; then
  echo "==> trivial opencode run (model opencode/$MODEL)"
  echo 'Reply with exactly the text SMOKE_OK and nothing else.' \
    | docker exec -i -w /workspace -e OPENCODE_API_KEY "$NAME" \
        opencode run --format json --model "opencode/$MODEL" \
    | tee /dev/stderr | grep -q 'SMOKE_OK'
else
  echo "==> OPENCODE_API_KEY not set; skipping opencode run"
fi

echo "==> copying a file out"
OUT="$(mktemp -d)"
docker cp "$NAME:/workspace/smoke.txt" "$OUT/"
test "$(cat "$OUT/smoke.txt")" = "smoke-ok"
rm -rf "$OUT"

echo "smoke passed"
