import type { ReactNode } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2, ExternalLink, RefreshCw, XCircle } from "lucide-react";
import { MANIFEST_PATH, type ProjectSettings, type Provider } from "@sdlc-ai/shared";
import { Section } from "~/components/Section";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { formatDateTime } from "~/lib/task-detail";
import { useProjectSettings } from "~/lib/settings-query";
import { cn } from "~/lib/utils";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

const PROVIDER_LABEL: Record<Provider, string> = { CLOUDFLARE: "Cloudflare", RENDER: "Render" };

function SettingsPage() {
  const query = useProjectSettings();

  return (
    <div className="flex flex-col gap-4 p-4 lg:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Settings</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Everything on this page is read from the control plane and the Project's repository at request time. Nothing is hardcoded in the UI.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void query.refetch()} disabled={query.isFetching}>
          <RefreshCw className={cn(query.isFetching && "animate-spin")} /> Re-read
        </Button>
      </header>

      {query.isPending && <p className="text-sm text-muted-foreground">Reading the Project…</p>}
      {query.isError && (
        <p role="alert" className="rounded-md border border-destructive/60 bg-destructive/10 px-3 py-2 text-sm text-red-200">
          Could not read the Project: {query.error.message}
        </p>
      )}
      {query.data && <SettingsView settings={query.data} />}
    </div>
  );
}

function SettingsView({ settings }: { settings: ProjectSettings }) {
  const { project, github, manifest, deployProviders } = settings;
  const repoUrl = `https://github.com/${project.owner}/${project.repo}`;

  return (
    <>
      {!manifest.ok && (
        <div role="alert" className="flex items-start gap-3 rounded-lg border border-amber-400/60 bg-amber-500/10 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" aria-hidden />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-amber-200">Project Manifest missing or invalid</p>
            <p className="mt-0.5 text-sm text-amber-100/90">
              The control plane cannot prepare a Workspace, run Checks, or run end-to-end tests until <span className="font-mono text-xs">{MANIFEST_PATH}</span> on{" "}
              <span className="font-mono text-xs">{project.defaultBranch}</span> is valid.
            </p>
            <pre className="mt-2 whitespace-pre-wrap break-words rounded bg-black/30 px-2 py-1.5 font-mono text-xs text-amber-100">{manifest.error}</pre>
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Project">
          <dl className="grid grid-cols-[8rem_minmax(0,1fr)] gap-y-2.5 text-sm">
            <Row label="Name">{project.name}</Row>
            <Row label="Repository">
              <a href={repoUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-xs text-sky-300 hover:underline">
                {project.owner}/{project.repo} <ExternalLink className="h-3 w-3" aria-hidden />
              </a>
            </Row>
            <Row label="Owner">
              <span className="font-mono text-xs">{project.owner}</span>
            </Row>
            <Row label="Default branch">
              <span className="font-mono text-xs">{project.defaultBranch}</span>
            </Row>
            <Row label="Registered">{formatDateTime(project.createdAt)}</Row>
          </dl>
        </Section>

        <Section
          title="GitHub connection"
          aside={github.ok ? <Badge variant="success">Connected</Badge> : <Badge variant="destructive">Not connected</Badge>}
        >
          <div className="flex items-start gap-3">
            {github.ok ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" aria-hidden /> : <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-300" aria-hidden />}
            <div className="min-w-0 text-sm">
              {github.ok ? (
                <>
                  <p>
                    Authenticated as <span className="font-mono text-xs">{github.login ?? "unknown"}</span> with access to{" "}
                    <span className="font-mono text-xs">
                      {project.owner}/{project.repo}
                    </span>
                    .
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">Issues, branches, pull requests, and merges are made through this identity.</p>
                </>
              ) : (
                <>
                  <p className="text-red-200">The control plane cannot reach GitHub.</p>
                  {github.error && <pre className="mt-1.5 whitespace-pre-wrap break-words rounded bg-black/30 px-2 py-1.5 font-mono text-xs text-red-100">{github.error}</pre>}
                </>
              )}
            </div>
          </div>
        </Section>

        <Section title="Deploy Targets" className="lg:col-span-2" aside={<span className="text-xs text-muted-foreground">{project.deployTargets.length} configured</span>}>
          {project.deployTargets.length === 0 ? (
            <p className="text-sm text-muted-foreground">No Deploy Target is configured. Merged changes will not be observed deploying.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="pb-2 pr-4 font-semibold">Target</th>
                  <th className="pb-2 pr-4 font-semibold">Provider</th>
                  <th className="pb-2 pr-4 font-semibold">Watched path prefix</th>
                  <th className="pb-2 pr-4 font-semibold">Public origin</th>
                  <th className="pb-2 font-semibold">Provider credentials</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {project.deployTargets.map((t) => (
                  <tr key={t.target}>
                    <td className="py-2.5 pr-4 font-semibold">{t.target}</td>
                    <td className="py-2.5 pr-4">{PROVIDER_LABEL[t.provider]}</td>
                    <td className="py-2.5 pr-4 font-mono text-xs">{t.pathPrefix}</td>
                    <td className="py-2.5 pr-4">
                      {t.url ? (
                        <a href={t.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sky-300 hover:underline">
                          {t.url} <ExternalLink className="h-3 w-3" aria-hidden />
                        </a>
                      ) : (
                        <span className="text-xs text-muted-foreground">Not set</span>
                      )}
                    </td>
                    <td className="py-2.5">
                      {deployProviders[t.provider] ? <Badge variant="success">Configured</Badge> : <Badge variant="warning">Missing</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        <Section
          title="Project Manifest"
          className="lg:col-span-2"
          aside={
            <span className="font-mono text-[11px] text-muted-foreground">
              {MANIFEST_PATH} @ {project.defaultBranch}
            </span>
          }
        >
          {manifest.ok ? <ManifestView manifest={manifest.manifest} /> : <p className="text-sm text-muted-foreground">Nothing to show until the Manifest reads cleanly. See the warning above.</p>}
        </Section>

        <Section title="Runtime" className="lg:col-span-2">
          <dl className="grid gap-y-2.5 text-sm sm:grid-cols-[10rem_minmax(0,1fr)]">
            <Row label="Developer model">
              <span className="font-mono text-xs">{settings.models.developer}</span>
            </Row>
            <Row label="Fast model">
              <span className="font-mono text-xs">{settings.models.fast}</span>
            </Row>
            <Row label="Sandbox image">
              <span className="font-mono text-xs">{settings.sandboxImage}</span>
            </Row>
            <Row label="Integrations">
              {settings.fakes ? <Badge variant="warning">Fakes (no Docker, GitHub, or deploy providers)</Badge> : <Badge variant="success">Live</Badge>}
            </Row>
            <Row label="Active Task">
              {settings.activeTask ? (
                <Link to="/tasks/$id" params={{ id: settings.activeTask.id }} className="text-sky-300 hover:underline">
                  {settings.activeTask.title} <span className="text-xs text-muted-foreground">in {settings.activeTask.stage.replace("_", " ")}</span>
                </Link>
              ) : (
                <span className="text-muted-foreground">None. A new Task can be started.</span>
              )}
            </Row>
          </dl>
        </Section>
      </div>
    </>
  );
}

function ManifestView({ manifest }: { manifest: Extract<ProjectSettings["manifest"], { ok: true }>["manifest"] }) {
  const env = Object.entries(manifest.e2e.env);
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <CommandList title="Setup" commands={manifest.setup} empty="No setup commands. The Workspace is used as cloned." />
      <CommandList title="Checks" commands={manifest.checks} empty="No Checks. Nothing runs before commit." />
      <div>
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">End-to-end tests</h3>
        <dl className="mt-2 flex flex-col gap-1.5 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">Command</dt>
            <dd className="font-mono text-xs">{manifest.e2e.command}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Working directory</dt>
            <dd className="font-mono text-xs">{manifest.e2e.cwd}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Environment</dt>
            <dd className="font-mono text-xs">
              {env.length === 0 ? <span className="font-sans text-muted-foreground">None</span> : env.map(([k, v]) => <div key={k}>{`${k}=${v}`}</div>)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Artifacts copied out</dt>
            <dd className="font-mono text-xs">
              {manifest.e2e.artifacts.length === 0 ? <span className="font-sans text-muted-foreground">None</span> : manifest.e2e.artifacts.map((a) => <div key={a}>{a}</div>)}
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

function CommandList({ title, commands, empty }: { title: string; commands: string[]; empty: string }) {
  return (
    <div>
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {commands.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">{empty}</p>
      ) : (
        <ol className="mt-2 flex flex-col gap-1">
          {commands.map((c, i) => (
            <li key={i} className="rounded bg-black/30 px-2 py-1 font-mono text-xs">
              <span className="mr-2 select-none text-muted-foreground">$</span>
              {c}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  );
}
