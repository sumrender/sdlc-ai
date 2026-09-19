// Prints the sandbox Dockerfile variant for the current host OS.
// win32 -> Dockerfile.windows; everything else -> Dockerfile.
// (WSL reports linux, which is correct: it builds like linux.)
// An explicit DOCKERFILE env var always wins; see build.mjs and smoke.sh.
import { fileURLToPath } from "node:url";

export function selectDockerfile(platform = process.platform) {
  return platform === "win32" ? "Dockerfile.windows" : "Dockerfile";
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${selectDockerfile()}\n`);
}
