import { MANIFEST_PATH, ProjectManifestSchema, type ProjectManifest } from "@sdlc-ai/shared";
import { ManifestError } from "../errors.js";
import type { GitHubService } from "../ports.js";

export async function loadManifest(github: GitHubService, ref: string): Promise<ProjectManifest> {
  const raw = await github.getFileContent(MANIFEST_PATH, ref);
  if (raw === null) {
    throw new ManifestError(`Project Manifest not found: ${MANIFEST_PATH} does not exist on ${ref}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    throw new ManifestError(`Project Manifest is not valid JSON: ${(e as Error).message}`);
  }
  const parsed = ProjectManifestSchema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`).join("; ");
    throw new ManifestError(`Project Manifest failed validation: ${issues}`);
  }
  return parsed.data;
}
