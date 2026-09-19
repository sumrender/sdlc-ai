import type { DeployLookup, DeployProvider } from "../ports.js";

interface RenderDeploy {
  deploy?: { id: string; status: string; commit?: { id?: string } };
  id?: string;
  status?: string;
  commit?: { id?: string };
}

export class RenderDeployProvider implements DeployProvider {
  constructor(
    private readonly apiKey: string,
    private readonly serviceId: string,
    private readonly publicUrl: string | null,
  ) {}

  async getDeployment(commitSha: string): Promise<DeployLookup> {
    const res = await fetch(`https://api.render.com/v1/services/${this.serviceId}/deploys?limit=20`, {
      headers: { Authorization: `Bearer ${this.apiKey}`, Accept: "application/json" },
    });
    if (!res.ok) return { status: "PENDING", url: null, providerRef: null, error: `render ${res.status}` };
    const body = (await res.json()) as RenderDeploy[];
    const match = body
      .map((d) => d.deploy ?? d)
      .find((d) => d.commit?.id && (d.commit.id === commitSha || d.commit.id.startsWith(commitSha) || commitSha.startsWith(d.commit.id)));
    if (!match) return { status: "PENDING", url: null, providerRef: null };
    return { status: mapStatus(match.status ?? ""), url: this.publicUrl, providerRef: match.id ?? null };
  }
}

function mapStatus(status: string): DeployLookup["status"] {
  switch (status) {
    case "live":
      return "LIVE";
    case "build_failed":
    case "update_failed":
    case "pre_deploy_failed":
    case "canceled":
    case "deactivated":
      return "FAILED";
    case "build_in_progress":
    case "update_in_progress":
    case "pre_deploy_in_progress":
      return "BUILDING";
    default:
      return "PENDING";
  }
}
