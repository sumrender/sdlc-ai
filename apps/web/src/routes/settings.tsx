import { useState, type ReactNode } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2, ExternalLink, RefreshCw, XCircle } from "lucide-react";
import { MANIFEST_PATH, MAX_CONCURRENT_TASKS_LIMIT, type ProjectSettings, type Provider } from "@sdlc-ai/shared";
import { Section } from "~/components/Section";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { formatDateTime } from "~/lib/task-detail";
import { useProjectSettings, useUpdateMaxConcurrentTasks, useUpdateReuseSandbox } from "~/lib/settings-query";
import { cn } from "~/lib/utils";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

const PROVIDER_LABEL: Record<Provider, string> = { CLOUDFLARE: "Cloudflare", RENDER: "Render" };

function SettingsPage() {
  const query = useProjectSettings();

  return (
    <div className="flex flex-col gap-3 p-4 lg:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
            <span>AI powered SDLC</span>
            <span aria-hidden>/</span>
            <span className="font-medium text-foreground">Settings</span>
          </nav>
          <h1 className="mt-1.5 text-xl font-semibold tracking-tight">Settings</h1>
          <p className="mt-1 max-w-2xl text-[13px] text-muted-foreground">
            Everything on this page is read from the control plane and the Project's repository at request time. Nothing is hardcoded in the UI.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void query.refetch()} disabled={query.isFetching}>
          <RefreshCw className={cn(query.isFetching && "animate-spin")} /> Re-read
        </Button>
      </header>

      {query.isPending && <p className="text-sm text-muted-foreground">Reading the Project…</p>}
      {query.isError && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
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
        <div role="alert" className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden />
          <div className="min-w-0">
            <p className="text-sm font-medium text-amber-800">Project Manifest missing or invalid</p>
            <p className="mt-0.5 text-sm text-amber-800">
              The control plane cannot prepare a Workspace, run Checks, or run end-to-end tests until <span className="font-mono text-xs">{MANIFEST_PATH}</span> on{" "}
              <span className="font-mono text-xs">{project.defaultBranch}</span> is valid.
            </p>
            <pre className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-amber-100/60 px-2 py-1.5 font-mono text-xs text-amber-900">{manifest.error}</pre>
          </div>
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        <Section title="Project">
          <dl className="grid grid-cols-[8rem_minmax(0,1fr)] gap-y-2.5 text-sm">
            <Row label="Name">{project.name}</Row>
            <Row label="Repository">
              <a href={repoUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-xs text-blue-700 hover:underline">
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
            {github.ok ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" aria-hidden /> : <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" aria-hidden />}
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
                  <p className="text-red-700">The control plane cannot reach GitHub.</p>
                  {github.error && <pre className="mt-1.5 whitespace-pre-wrap break-words rounded-lg bg-red-50 px-2 py-1.5 font-mono text-xs text-red-700">{github.error}</pre>}
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
              <tbody className="divide-y divide-border">
                {project.deployTargets.map((t) => (
                  <tr key={t.target}>
                    <td className="py-2.5 pr-4 font-semibold">{t.target}</td>
                    <td className="py-2.5 pr-4">{PROVIDER_LABEL[t.provider]}</td>
                    <td className="py-2.5 pr-4 font-mono text-xs">{t.pathPrefix}</td>
                    <td className="py-2.5 pr-4">
                      {t.url ? (
                        <a href={t.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue-700 hover:underline">
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

        <Section title="Concurrency" aside={<span className="text-xs text-muted-foreground">Starts are blocked at the limit</span>}>
          <ConcurrencyEditor settings={settings} />
        </Section>

        <Section title="Sandbox reuse" aside={<span className="text-xs text-muted-foreground">Faster runs, one container per task</span>}>
          <ReuseSandboxEditor settings={settings} />
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
              <div className="flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs">{settings.sandboxImage}</span>
                  {settings.sandboxImageStatus.ok ? <Badge variant="success">Up to date</Badge> : <Badge variant="warning">Stale</Badge>}
                </div>
                {settings.sandboxImageStatus.warning && <p className="text-xs text-amber-700">{settings.sandboxImageStatus.warning}</p>}
              </div>
            </Row>
            <Row label="Integrations">
              {settings.fakes ? <Badge variant="warning">Fakes (no Docker, GitHub, or deploy providers)</Badge> : <Badge variant="success">Live</Badge>}
            </Row>
            <Row label="Active Tasks">
              {settings.activeTasks.length > 0 ? (
                <ul className="flex flex-col gap-1">
                  <li className="text-xs text-muted-foreground">
                    {settings.activeTaskCount} of {settings.maxConcurrentTasks} slots used
                  </li>
                  {settings.activeTasks.map((t) => (
                    <li key={t.id}>
                      <Link to="/tasks/$id" params={{ id: t.id }} className="text-blue-700 hover:underline">
                        {t.title} <span className="text-xs text-muted-foreground">in {t.stage.replace("_", " ")}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
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
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-3">
        <CommandList title="Shared setup" commands={manifest.setup} empty="No shared setup commands." />
        <CommandList title="Shared checks (always run)" commands={manifest.checks} empty="No shared checks." />
        <E2EView e2e={manifest.e2e} />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {manifest.frontend && <StackView title="Frontend" stack={manifest.frontend} />}
        {manifest.backend && <StackView title="Backend" stack={manifest.backend} />}
        {!manifest.frontend && !manifest.backend && (
          <p className="text-sm text-muted-foreground">No frontend/backend stacks declared. All checks run for every change.</p>
        )}
      </div>
    </div>
  );
}

function StackView({ title, stack }: { title: string; stack: NonNullable<Extract<ProjectSettings["manifest"], { ok: true }>["manifest"]["frontend"]> }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <h3 className="text-[13px] font-semibold">
        {title} <span className="ml-1 font-mono text-[11px] font-normal text-muted-foreground">{stack.dir}</span>
      </h3>
      <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">paths: {stack.paths.length > 0 ? stack.paths.join(", ") : `${stack.dir}/**`}</p>
      <div className="mt-2 grid gap-3">
        <CommandList title="Setup" commands={stack.setup} empty="No setup commands." />
        <CommandList title="Checks (run when this stack changes)" commands={stack.checks} empty="No checks." />
        <div>
          <h4 className="text-[11px] font-medium text-muted-foreground">Unit tests</h4>
          {stack.unitTests ? (
            <div className="mt-1 font-mono text-xs">
              <div>$ {stack.unitTests.command}</div>
              <div className="text-muted-foreground">
                cwd: {stack.unitTests.cwd}
                {stack.unitTests.optional ? " · optional" : ""}
              </div>
            </div>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">Not configured.</p>
          )}
        </div>
        <div>
          <h4 className="text-[11px] font-medium text-muted-foreground">Integrations</h4>
          {stack.integrations.length === 0 ? (
            <p className="mt-1 text-xs text-muted-foreground">None declared.</p>
          ) : (
            <ul className="mt-1 flex flex-col gap-1.5">
              {stack.integrations.map((i) => (
                <li key={i.name} className="text-xs">
                  <span className="font-medium">{i.name}</span>
                  {i.notes && <span className="text-muted-foreground"> — {i.notes}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function E2EView({ e2e }: { e2e: Extract<ProjectSettings["manifest"], { ok: true }>["manifest"]["e2e"] }) {
  if (!e2e) {
    return (
      <div>
        <h3 className="text-[11px] font-medium text-muted-foreground">End-to-end tests</h3>
        <p className="mt-2 text-xs text-muted-foreground">Not configured. The E2E gate passes without running.</p>
      </div>
    );
  }
  const env = Object.entries(e2e.env);
  return (
    <div>
      <h3 className="text-[11px] font-medium text-muted-foreground">End-to-end tests</h3>
      <dl className="mt-2 flex flex-col gap-1.5 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">Command</dt>
          <dd className="font-mono text-xs">{e2e.command}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Working directory</dt>
          <dd className="font-mono text-xs">{e2e.cwd}</dd>
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
            {e2e.artifacts.length === 0 ? <span className="font-sans text-muted-foreground">None</span> : e2e.artifacts.map((a) => <div key={a}>{a}</div>)}
          </dd>
        </div>
      </dl>
    </div>
  );
}

function CommandList({ title, commands, empty }: { title: string; commands: string[]; empty: string }) {
  return (
    <div>
      <h3 className="text-[11px] font-medium text-muted-foreground">{title}</h3>
      {commands.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">{empty}</p>
      ) : (
        <ol className="mt-2 flex flex-col gap-1">
          {commands.map((c, i) => (
            <li key={i} className="rounded-lg bg-secondary px-2 py-1 font-mono text-xs">
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

function ConcurrencyEditor({ settings }: { settings: ProjectSettings }) {
  const [value, setValue] = useState(String(settings.maxConcurrentTasks));
  const [savedValue, setSavedValue] = useState(settings.maxConcurrentTasks);
  const mutation = useUpdateMaxConcurrentTasks();
  const dirty = value !== String(savedValue ?? settings.maxConcurrentTasks);

  const parsed = Number.parseInt(value, 10);
  const valid = Number.isInteger(parsed) && parsed >= 1 && parsed <= MAX_CONCURRENT_TASKS_LIMIT;

  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="text-muted-foreground">
        {settings.activeTaskCount} of {settings.maxConcurrentTasks} task slots in use. Lowering the limit never stops running Tasks; it only
        blocks new Starts.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="max-concurrent-tasks" className="text-xs text-muted-foreground">
          Max concurrent tasks (1–{MAX_CONCURRENT_TASKS_LIMIT})
        </label>
        <Input
          id="max-concurrent-tasks"
          type="number"
          min={1}
          max={MAX_CONCURRENT_TASKS_LIMIT}
          className="w-24"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <Button
          size="sm"
          disabled={!dirty || !valid || mutation.isPending}
          onClick={() => {
            if (!valid) return;
            mutation.mutate(parsed, { onSuccess: (next) => setSavedValue(next.maxConcurrentTasks) });
          }}
        >
          {mutation.isPending ? "Saving…" : "Save"}
        </Button>
      </div>
      {!valid && (
        <p role="alert" className="text-xs text-red-600">
          Enter a whole number between 1 and {MAX_CONCURRENT_TASKS_LIMIT}.
        </p>
      )}
      {mutation.isError && (
        <p role="alert" className="text-xs text-red-600">
          Could not save the limit: {mutation.error.message}
        </p>
      )}
      {mutation.isSuccess && !dirty && <p className="text-xs text-emerald-700">Limit saved.</p>}
    </div>
  );
}

function ReuseSandboxEditor({ settings }: { settings: ProjectSettings }) {
  const mutation = useUpdateReuseSandbox();
  const checked = settings.reuseSandbox ?? true;

  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="text-muted-foreground">
        Reuse one container for the whole task. Setup runs once, each gate starts a fresh session and the workspace is reset to a clean
        git state before switching.
      </p>
      <label htmlFor="reuse-sandbox" className="flex cursor-pointer items-center gap-2">
        <input
          id="reuse-sandbox"
          type="checkbox"
          className="h-4 w-4 accent-current"
          checked={checked}
          disabled={mutation.isPending}
          onChange={(e) => mutation.mutate(e.target.checked)}
        />
        <span>Reuse sandbox container across gates{mutation.isPending ? " (saving…)" : ""}</span>
      </label>
      {mutation.isError && (
        <p role="alert" className="text-xs text-red-600">
          Could not save the setting: {mutation.error.message}
        </p>
      )}
      {mutation.isSuccess && <p className="text-xs text-emerald-700">Setting saved.</p>}
    </div>
  );
}
