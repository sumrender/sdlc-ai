/** Project config loader. Reads the local sdlc.config.ts (never the repo); prefer it directly. */
export { loadManifest, loadManifestForTask } from "./config-loader.js";
/** @deprecated Compat shim only (the fakes serve it; nothing reads the repo). Prefer sdlc.config.ts. */
export { MANIFEST_PATH } from "@sdlc-ai/shared";
