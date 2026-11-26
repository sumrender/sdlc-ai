import { useEffect, useState, type ReactNode } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, Archive, CheckCircle2, ExternalLink, KeyRound, Pencil, RefreshCw, RotateCcw, Trash2, X, XCircle } from "lucide-react";
import { MAX_CONCURRENT_TASKS_LIMIT, type EnvValue, type ProjectSettings, type Provider, type UpdateProjectInputRaw } from "@sdlc-ai/shared";
import { DeleteProjectDialog } from "~/components/DeleteProjectDialog";
import { ProjectForm } from "~/components/ProjectForm";
import { Section } from "~/components/Section";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { formatDateTime } from "~/lib/task-detail";
import {
  useArchiveProject,
  useProjectSettings,
  useRestoreProject,
  useUpdateMaxConcurrentTasks,
  useUpdateProject,
  useUpdateReuseSandbox,
} from "~/lib/settings-query";
import { cn } from "~/lib/utils";
import { LAST_PROJECT_STORAGE_KEY } from "./index";

export const Route = createFileRoute("/projects/$slug/settings")({
  component: ProjectSettingsPage,
});

const PROVIDER_LABEL: Record<Provider, string> = { CLOUDFLARE: "Cloudflare", RENDER: "Render" };

function ProjectSettingsPage() {
  const { slug } = Route.useParams();
  const query = useProjectSettings(slug);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    setEditing(false);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(LAST_PROJECT_STORAGE_KEY, slug);
    }
  }, [slug]);

  return (
    <div className="flex flex-col gap-3 p-4 lg:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
            <Link to="/projects/$slug" params={{ slug }} className="hover:text-foreground hover:underline">
              {query.data?.project.name ?? slug}
            </Link>
            <span aria-hidden>/</span>
            <span className="font-medium text-foreground">Settings</span>
          </nav>
          <h1 className="mt-1.5 text-xl font-semibold tracking-tight">Settings</h1>
          <p className="mt-1 max-w-2xl text-[13px] text-muted-foreground">
            Project configuration, manifest, deploy targets, and encrypted secrets stored in PostgreSQL.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {query.data && (
            <Button variant={editing ? "secondary" : "default"} size="sm" onClick={() => setEditing((v) => !v)}>
              {editing ? (
                <>
                  <X /> Cancel editing
                </>
              ) : (
                <>
                  <Pencil /> Edit Project
                </>
              )}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => void query.refetch()} disabled={query.isFetching}>
            <RefreshCw className={cn(query.isFetching && "animate-spin")} /> Re-read
          </Button>
        </div>
      </header>

      {query.isPending && <p className="text-sm text-muted-foreground">Reading Project "{slug}"…</p>}
      {query.isError && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          Could not read the Project: {query.error.message}
        </p>
      )}
      {query.data && (
        <SettingsContent
          key={`${query.data.project.id}:${query.data.project.updatedAt}:${editing ? "edit" : "view"}`}
          settings={query.data}
          editing={editing}
          onDoneEditing={() => setEditing(false)}
        />
      )}
    </div>
  );
}

function SettingsContent({
  settings,
  editing,
  onDoneEditing,
}: {
  settings: ProjectSettings;
  editing: boolean;
  onDoneEditing: () => void;
}) {
  const { project } = settings;
  const updateProject = useUpdateProject(project.id);
  const archiveProject = useArchiveProject(project.id);
  const restoreProject = useRestoreProject(project.id);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const handleUpdate = (input: UpdateProjectInputRaw) => {
    updateProject.mutate(input, {
      onSuccess: () => onDoneEditing(),
    });
  };

  return (
    <>
      {project.archivedAt !== null && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <div className="flex items-start gap-2.5">
            <Archive className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden />
            <div>
              <p className="font-medium">Project archived</p>
              <p className="text-xs text-amber-800">
                Archived {formatDateTime(project.archivedAt)}. Task creation and starts are blocked until restored.
              </p>
            </div>
          </div>
          <Button size="sm" variant="outline" onClick={() => restoreProject.mutate()} disabled={restoreProject.isPending}>
            <RotateCcw /> {restoreProject.isPending ? "Restoring…" : "Restore Project"}
          </Button>
        </div>
      )}
      {restoreProject.isError && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          Could not restore project: {restoreProject.error.message}
        </p>
      )}

      {editing ? (
        <ProjectForm
          mode="edit"
          initial={settings}
          submitting={updateProject.isPending}
          submitError={updateProject.isError ? updateProject.error.message : null}
          onSubmit={handleUpdate}
          onCancel={onDoneEditing}
        />
      ) : (
        <SettingsView
          settings={settings}
          onArchive={() => archiveProject.mutate()}
          archiving={archiveProject.isPending}
          archiveError={archiveProject.isError ? archiveProject.error.message : null}
          onOpenDelete={() => setDeleteOpen(true)}
        />
      )}

      <DeleteProjectDialog project={project} open={deleteOpen} onOpenChange={setDeleteOpen} />
    </>
  );
}

function SettingsView({
  settings,
  onArchive,
  archiving,
  archiveError,
  onOpenDelete,
}: {
  settings: ProjectSettings;
  onArchive: () => void;
  archiving: boolean;
  archiveError: string | null;
  onOpenDelete: () => void;
}) {
  const { project, github, manifest, deployProviders, deployWarnings, secrets } = settings;
  const repoUrl = `https://github.com/${project.owner}/${project.repo}`;
  const manifestLabel =
    manifest.ok && manifest.hash && manifest.loadedAt
      ? `database · rev ${manifest.hash.slice(0, 12)} · ${formatDateTime(manifest.loadedAt)}`
      : `database`;

  return (
    <>

      <div className="grid gap-3 lg:grid-cols-2">
        <Section title="Project">
          <dl className="grid grid-cols-[8rem_minmax(0,1fr)] gap-y-2.5 text-sm">
            <Row label="Name">{project.name}</Row>
            <Row label="Slug">
              <span className="font-mono text-xs">{project.slug}</span>
            </Row>
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
          {deployWarnings.length > 0 && (
            <div role="alert" className="mb-3 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden />
              <div className="min-w-0">
                <p className="text-sm font-medium text-amber-800">Deploy target watches no stack paths</p>
                <ul className="mt-0.5 flex flex-col gap-0.5 text-sm text-amber-800">
                  {deployWarnings.map((w) => (
                    <li key={w} className="font-mono text-xs">{w}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
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
              {manifestLabel}
            </span>
          }
        >
          {manifest.ok ? <ManifestView manifest={manifest.manifest} /> : <p className="text-sm text-muted-foreground">Nothing to show until the Manifest reads cleanly. See the warning above.</p>}
        </Section>

        <Section title="Concurrency" aside={<span className="text-xs text-muted-foreground">Starts are blocked at the limit</span>}>
          <ConcurrencyEditor key={project.id} settings={settings} />
        </Section>

        <Section title="Sandbox reuse" aside={<span className="text-xs text-muted-foreground">Faster runs, one container per task</span>}>
          <ReuseSandboxEditor key={project.id} settings={settings} />
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
                    {settings.activeTaskCount} of {settings.maxConcurrentTasks} project slots used ({settings.globalActiveTaskCount} of {settings.maxGlobalConcurrentTasks} host-wide)
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
                <span className="text-muted-foreground">
                  None for this project ({settings.globalActiveTaskCount} of {settings.maxGlobalConcurrentTasks} host-wide).
                </span>
              )}
            </Row>
          </dl>
        </Section>

        <Section
          title="Project Secrets"
          className="lg:col-span-2"
          aside={
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <KeyRound className="h-3.5 w-3.5" aria-hidden /> Encrypted at rest · write-only
            </span>
          }
        >
          {secrets.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No project secrets configured yet. Click <span className="font-medium text-foreground">Edit Project</span> to store a GitHub token or
              manifest secret.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="pb-2 pr-4 font-semibold">Name</th>
                    <th className="pb-2 pr-4 font-semibold">Hint</th>
                    <th className="pb-2 font-semibold">Last updated</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {secrets.map((secret) => (
                    <tr key={secret.name}>
                      <td className="py-2 pr-4 font-mono text-xs font-medium">{secret.name}</td>
                      <td className="py-2 pr-4 font-mono text-xs text-muted-foreground">{secret.hint}</td>
                      <td className="py-2 text-xs text-muted-foreground">{formatDateTime(secret.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        <Section title="Danger Zone" className="lg:col-span-2">
          <div className="flex flex-col gap-3">
            {project.archivedAt === null && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3">
                <div>
                  <p className="text-sm font-medium">Archive this project</p>
                  <p className="text-xs text-muted-foreground">
                    Hide this project from active views and block new Tasks while keeping historical Tasks, Runs, and Artifacts intact.
                  </p>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={onArchive} disabled={archiving}>
                  <Archive /> {archiving ? "Archiving…" : "Archive Project"}
                </Button>
              </div>
            )}

            {archiveError && (
              <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                Could not archive project: {archiveError}
              </p>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50/40 p-3">
              <div>
                <p className="text-sm font-medium text-red-900">Delete permanently</p>
                <p className="text-xs text-red-800">
                  Permanently delete this project and cascade-remove all Tasks, Runs, Artifacts, Deployments, and Secrets.
                </p>
              </div>
              <Button type="button" variant="destructive" size="sm" onClick={onOpenDelete}>
                <Trash2 /> Delete Permanently
              </Button>
            </div>
          </div>
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

function formatEnvValue(value: EnvValue): string {
  return typeof value === "string" ? value : `<env:${value.env}${value.optional ? "?" : ""}>`;
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
          <dt className="text-xs text-muted-foreground">Spec directory</dt>
          <dd className="font-mono text-xs">
            {joinPath(e2e.cwd, e2e.testDir)} <span className="font-sans text-muted-foreground">({e2e.testDir} relative to the working directory)</span>
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Environment</dt>
          <dd className="font-mono text-xs">
            {env.length === 0 ? (
              <span className="font-sans text-muted-foreground">None</span>
            ) : (
              env.map(([k, v]) => <div key={k}>{`${k}=${formatEnvValue(v)}`}</div>)
            )}
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

/** Joins a manifest `cwd` with a path relative to it, collapsing the repo-root `"."` case. */
function joinPath(cwd: string, relative: string): string {
  const base = cwd.replace(/\/+$/, "");
  return base === "" || base === "." ? relative : `${base}/${relative}`;
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
  const mutation = useUpdateMaxConcurrentTasks(settings.project.id);
  const dirty = value !== String(savedValue ?? settings.maxConcurrentTasks);

  const parsed = Number.parseInt(value, 10);
  const valid = Number.isInteger(parsed) && parsed >= 1 && parsed <= MAX_CONCURRENT_TASKS_LIMIT;

  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="text-muted-foreground">
        {settings.activeTaskCount} of {settings.maxConcurrentTasks} project slots in use ({settings.globalActiveTaskCount} of{" "}
        {settings.maxGlobalConcurrentTasks} host-wide). Lowering the limit never stops running Tasks; it only blocks new Starts.
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
  const mutation = useUpdateReuseSandbox(settings.project.id);
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
