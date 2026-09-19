import type { DeployLookup, DeployProvider } from "../ports.js";

interface CloudflareBuild {
  build_uuid?: string;
  status?: string;
  build_outcome?: string | null;
  build_trigger_metadata?: { commit_hash?: string };
}

export class CloudflareDeployProvider implements DeployProvider {
  constructor(
    private readonly token: string,
    private readonly accountId: string,
    private readonly workerName: string,
    private readonly publicUrl: string | null,
  ) {}

  async getDeployment(commitSha: string): Promise<DeployLookup> {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/builds/workers/${this.workerName}/builds?per_page=20`,
      { headers: { Authorization: `Bearer ${this.token}`, Accept: "application/json" } },
    );
    if (!res.ok) return { status: "PENDING", url: null, providerRef: null, error: `cloudflare ${res.status}` };
    const body = (await res.json()) as { result?: CloudflareBuild[] | { builds?: CloudflareBuild[] } };
    const builds = Array.isArray(body.result) ? body.result : body.result?.builds ?? [];
    const match = builds.find((b) => {
      const hash = b.build_trigger_metadata?.commit_hash;
      return hash && (hash === commitSha || hash.startsWith(commitSha) || commitSha.startsWith(hash));
    });
    if (!match) return { status: "PENDING", url: null, providerRef: null };
    return { status: mapStatus(match), url: this.publicUrl, providerRef: match.build_uuid ?? null };
  }
}

function mapStatus(build: CloudflareBuild): DeployLookup["status"] {
  if (build.status === "stopped") return build.build_outcome === "success" ? "LIVE" : "FAILED";
  if (build.status === "running" || build.status === "initializing") return "BUILDING";
  return "PENDING";
}
