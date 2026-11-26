import { useMemo, useState, type FormEvent } from "react";
import { AlertTriangle, CheckCircle2, Code2, Eye, EyeOff, KeyRound, Plus, SlidersHorizontal, Trash2, XCircle } from "lucide-react";
import {
  DEFAULT_MAX_CONCURRENT_TASKS,
  DEPLOY_TARGETS,
  MAX_CONCURRENT_TASKS_LIMIT,
  ProjectManifestSchema,
  ProjectSlugSchema,
  PROVIDERS,
  SecretNameSchema,
  deployOverlapWarnings,
  resolveDeployTargetUrls,
  slugifyProject,
  type CreateProjectInputRaw,
  type DeployTarget,
  type DeployTargetConfig,
  type E2eConfig,
  type EnvValue,
  type ProjectManifest,
  type ProjectSettings,
  type Provider,
  type SecretMeta,
  type StackManifest,
  type UpdateProjectInputRaw,
} from "@sdlc-ai/shared";
import { Section } from "~/components/Section";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import {
  useDeleteProjectSecret,
  useTestProjectConnection,
  useUpsertProjectSecret,
} from "~/lib/settings-query";
import { formatDateTime } from "~/lib/task-detail";
import { cn } from "~/lib/utils";

type ManifestTab = "form" | "json";

export type ProjectFormProps =
  | {
      mode: "create";
      submitting: boolean;
      submitError: string | null;
      onSubmit: (input: CreateProjectInputRaw) => void;
      onCancel?: () => void;
    }
  | {
      mode: "edit";
      initial: ProjectSettings;
      submitting: boolean;
      submitError: string | null;
      onSubmit: (input: UpdateProjectInputRaw) => void;
      onCancel?: () => void;
    };

interface DraftSecretRow {
  id: string;
  name: string;
  value: string;
}

const DEFAULT_MANIFEST: ProjectManifest = {
  setup: [],
  checks: [],
  e2e: null,
};

function linesToArray(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function arrayToLines(items: readonly string[] | undefined): string {
  return (items ?? []).join("\n");
}

function envToLines(env: Record<string, EnvValue> | undefined): string {
  return Object.entries(env ?? {})
    .map(([key, val]) => (typeof val === "string" ? `${key}=${val}` : `${key}=@secret:${val.env}${val.optional ? "?" : ""}`))
    .join("\n");
}

function linesToEnv(text: string): Record<string, EnvValue> {
  const out: Record<string, EnvValue> = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const val = line.slice(eq + 1).trim();
    if (val.startsWith("@secret:")) {
      const secretSpec = val.slice("@secret:".length);
      const optional = secretSpec.endsWith("?");
      const envName = (optional ? secretSpec.slice(0, -1) : secretSpec).trim();
      if (envName) out[key] = { env: envName, optional };
    } else {
      out[key] = val;
    }
  }
  return out;
}

export function ProjectForm(props: ProjectFormProps) {
  const isEdit = props.mode === "edit";
  const initialProject = isEdit ? props.initial.project : null;

  const [name, setName] = useState(initialProject?.name ?? "");
  const [slug, setSlug] = useState(initialProject?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(isEdit);
  const [owner, setOwner] = useState(initialProject?.owner ?? "");
  const [repo, setRepo] = useState(initialProject?.repo ?? "");
  const [defaultBranch, setDefaultBranch] = useState(initialProject?.defaultBranch ?? "main");

  const [githubToken, setGithubToken] = useState("");
  const [showGithubToken, setShowGithubToken] = useState(false);

  const initialManifest = initialProject?.manifest ?? DEFAULT_MANIFEST;
  const [manifestTab, setManifestTab] = useState<ManifestTab>("form");
  const [manifestDraft, setManifestDraft] = useState<ProjectManifest>(initialManifest);
  const [manifestJson, setManifestJson] = useState(() => JSON.stringify(initialManifest, null, 2));
  const [manifestJsonError, setManifestJsonError] = useState<string | null>(null);

  const [deployTargets, setDeployTargets] = useState<DeployTargetConfig[]>(initialProject?.deployTargets ?? []);
  const [cfEnabled, setCfEnabled] = useState(Boolean(initialProject?.deployProviders.cloudflare));
  const [cfWorkerName, setCfWorkerName] = useState(initialProject?.deployProviders.cloudflare?.workerName ?? "");
  const [cfOrigin, setCfOrigin] = useState(initialProject?.deployProviders.cloudflare?.origin ?? "");
  const [renderEnabled, setRenderEnabled] = useState(Boolean(initialProject?.deployProviders.render));
  const [renderServiceId, setRenderServiceId] = useState(initialProject?.deployProviders.render?.serviceId ?? "");
  const [renderOrigin, setRenderOrigin] = useState(initialProject?.deployProviders.render?.origin ?? "");

  const [devModel, setDevModel] = useState(initialProject?.models?.developer ?? "");
  const [fastModel, setFastModel] = useState(initialProject?.models?.fast ?? "");
  const [sandboxImage, setSandboxImage] = useState(initialProject?.sandboxImage ?? "");
  const [maxConcurrentTasks, setMaxConcurrentTasks] = useState(
    String(initialProject?.maxConcurrentTasks ?? DEFAULT_MAX_CONCURRENT_TASKS),
  );
  const [reuseSandbox, setReuseSandbox] = useState(initialProject?.reuseSandbox ?? true);

  const [draftSecrets, setDraftSecrets] = useState<DraftSecretRow[]>([]);
  const [newSecretName, setNewSecretName] = useState("");
  const [newSecretValue, setNewSecretValue] = useState("");
  const [secretError, setSecretError] = useState<string | null>(null);

  const [validationError, setValidationError] = useState<string | null>(null);

  const testConn = useTestProjectConnection();
  const upsertSecret = useUpsertProjectSecret(initialProject?.id ?? "");
  const deleteSecret = useDeleteProjectSecret(initialProject?.id ?? "");

  const existingSecrets: SecretMeta[] = isEdit ? props.initial.secrets : [];
  const hasSavedGithubToken = existingSecrets.some((s) => s.name === "GITHUB_TOKEN");

  const effectiveManifestResult = useMemo(() => {
    if (manifestTab === "form") {
      return ProjectManifestSchema.safeParse(manifestDraft);
    }
    try {
      const parsedJson: unknown = JSON.parse(manifestJson);
      return ProjectManifestSchema.safeParse(parsedJson);
    } catch {
      return null;
    }
  }, [manifestDraft, manifestJson, manifestTab]);

  const liveDeployProviders = useMemo(() => {
    return {
      ...(cfEnabled && cfWorkerName.trim()
        ? { cloudflare: { workerName: cfWorkerName.trim(), origin: cfOrigin.trim() || null } }
        : {}),
      ...(renderEnabled && renderServiceId.trim()
        ? { render: { serviceId: renderServiceId.trim(), origin: renderOrigin.trim() || null } }
        : {}),
    };
  }, [cfEnabled, cfWorkerName, cfOrigin, renderEnabled, renderServiceId, renderOrigin]);

  const liveOverlapWarnings = useMemo(() => {
    if (!effectiveManifestResult?.success) return [];
    return deployOverlapWarnings(resolveDeployTargetUrls(deployTargets, liveDeployProviders), effectiveManifestResult.data);
  }, [deployTargets, effectiveManifestResult, liveDeployProviders]);

  const slugValidation = useMemo(() => {
    if (isEdit) return null;
    const candidate = slug.trim();
    if (!candidate) return null;
    return ProjectSlugSchema.safeParse(candidate);
  }, [isEdit, slug]);

  const handleRepoChange = (nextRepo: string) => {
    setRepo(nextRepo);
    if (!isEdit && !slugTouched) {
      setSlug(nextRepo.trim() ? slugifyProject(nextRepo) : "");
    }
  };

  const switchManifestTab = (next: ManifestTab) => {
    if (next === manifestTab) return;
    if (next === "json") {
      setManifestJson(JSON.stringify(manifestDraft, null, 2));
      setManifestJsonError(null);
      setManifestTab("json");
      return;
    }
    try {
      const raw: unknown = JSON.parse(manifestJson);
      const parsed = ProjectManifestSchema.safeParse(raw);
      if (!parsed.success) {
        setManifestJsonError(parsed.error.issues.map((i) => `${i.path.join(".") || "manifest"}: ${i.message}`).join("; "));
        return;
      }
      setManifestDraft(parsed.data);
      setManifestJsonError(null);
      setManifestTab("form");
    } catch (err) {
      setManifestJsonError(err instanceof Error ? err.message : "Invalid JSON");
    }
  };

  const addDraftSecret = () => {
    const cleanName = newSecretName.trim().toUpperCase();
    const nameParsed = SecretNameSchema.safeParse(cleanName);
    if (!nameParsed.success) {
      setSecretError(nameParsed.error.issues[0]?.message ?? "Invalid secret name");
      return;
    }
    if (!newSecretValue) {
      setSecretError("Secret value cannot be empty");
      return;
    }
    setSecretError(null);
    if (isEdit) {
      upsertSecret.mutate(
        { name: cleanName, input: { value: newSecretValue } },
        {
          onSuccess: () => {
            setNewSecretName("");
            setNewSecretValue("");
          },
          onError: (err) => setSecretError(err.message),
        },
      );
      return;
    }
    setDraftSecrets((prev) => {
      const without = prev.filter((r) => r.name !== cleanName);
      return [...without, { id: crypto.randomUUID(), name: cleanName, value: newSecretValue }];
    });
    setNewSecretName("");
    setNewSecretValue("");
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setValidationError(null);

    if (!owner.trim() || !repo.trim() || !defaultBranch.trim()) {
      setValidationError("Repository owner, repo, and default branch are required.");
      return;
    }

    if (!isEdit && slug.trim()) {
      const slugOk = ProjectSlugSchema.safeParse(slug.trim());
      if (!slugOk.success) {
        setValidationError(slugOk.error.issues[0]?.message ?? "Invalid project slug.");
        return;
      }
    }

    let finalManifest: ProjectManifest;
    if (manifestTab === "form") {
      const parsed = ProjectManifestSchema.safeParse(manifestDraft);
      if (!parsed.success) {
        setValidationError(`Manifest error: ${parsed.error.issues[0]?.message ?? "invalid manifest"}`);
        return;
      }
      finalManifest = parsed.data;
    } else {
      try {
        const raw: unknown = JSON.parse(manifestJson);
        const parsed = ProjectManifestSchema.safeParse(raw);
        if (!parsed.success) {
          setValidationError(`Manifest error: ${parsed.error.issues[0]?.message ?? "invalid manifest"}`);
          return;
        }
        finalManifest = parsed.data;
      } catch (err) {
        setValidationError(`Manifest JSON error: ${err instanceof Error ? err.message : "invalid JSON"}`);
        return;
      }
    }

    if (cfEnabled && !cfWorkerName.trim()) {
      setValidationError("Cloudflare worker name is required when Cloudflare provider is enabled.");
      return;
    }
    if (renderEnabled && !renderServiceId.trim()) {
      setValidationError("Render service ID is required when Render provider is enabled.");
      return;
    }

    const parsedLimit = Number.parseInt(maxConcurrentTasks, 10);
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > MAX_CONCURRENT_TASKS_LIMIT) {
      setValidationError(`Max concurrent tasks must be a whole number between 1 and ${MAX_CONCURRENT_TASKS_LIMIT}.`);
      return;
    }

    const hasDevModel = devModel.trim().length > 0;
    const hasFastModel = fastModel.trim().length > 0;
    if (hasDevModel !== hasFastModel) {
      setValidationError("Provide both Developer model and Fast model overrides, or leave both blank.");
      return;
    }

    const models = hasDevModel && hasFastModel ? { developer: devModel.trim(), fast: fastModel.trim() } : null;

    const cleanDeployTargets = deployTargets.map((t) => ({
      ...t,
      pathPrefix: t.pathPrefix.trim(),
      url: t.url?.trim() ? t.url.trim() : null,
    }));
    if (cleanDeployTargets.some((t) => t.pathPrefix.length === 0)) {
      setValidationError("Each deploy target must specify a watched path prefix.");
      return;
    }

    const secretsMap: Record<string, string> = {};
    if (!isEdit) {
      for (const row of draftSecrets) {
        secretsMap[row.name] = row.value;
      }
    }
    if (githubToken.trim()) {
      secretsMap.GITHUB_TOKEN = githubToken.trim();
    }

    const repository = {
      owner: owner.trim(),
      repo: repo.trim(),
      defaultBranch: defaultBranch.trim(),
    };

    if (props.mode === "create") {
      const payload: CreateProjectInputRaw = {
        ...(slug.trim() ? { slug: slug.trim() } : {}),
        ...(name.trim() ? { name: name.trim() } : {}),
        repository,
        manifest: finalManifest,
        deployTargets: cleanDeployTargets,
        deployProviders: liveDeployProviders,
        models,
        sandboxImage: sandboxImage.trim() || null,
        maxConcurrentTasks: parsedLimit,
        reuseSandbox,
        ...(Object.keys(secretsMap).length > 0 ? { secrets: secretsMap } : {}),
      };
      props.onSubmit(payload);
    } else {
      const payload: UpdateProjectInputRaw = {
        ...(name.trim() ? { name: name.trim() } : {}),
        repository,
        manifest: finalManifest,
        deployTargets: cleanDeployTargets,
        deployProviders: liveDeployProviders,
        models,
        sandboxImage: sandboxImage.trim() || null,
        maxConcurrentTasks: parsedLimit,
        reuseSandbox,
        ...(Object.keys(secretsMap).length > 0 ? { secrets: secretsMap } : {}),
      };
      props.onSubmit(payload);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <Section title="Repository & Identity">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Display name" htmlFor="pf-name" hint="Optional. Defaults to owner/repo.">
            <Input id="pf-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Meme Studio" />
          </Field>
          <Field
            label="Slug"
            htmlFor="pf-slug"
            hint={isEdit ? "Slug cannot be changed after creation." : "Lowercase kebab-case URL identifier (auto-derived from repo)."}
          >
            <Input
              id="pf-slug"
              value={slug}
              disabled={isEdit}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(e.target.value.toLowerCase());
              }}
              placeholder="my-project"
              className="font-mono text-xs"
            />
            {slugValidation && !slugValidation.success && (
              <p className="mt-1 text-xs text-red-600">{slugValidation.error.issues[0]?.message}</p>
            )}
          </Field>

          <Field label="GitHub owner" htmlFor="pf-owner" required>
            <Input id="pf-owner" value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="octocat" className="font-mono text-xs" />
          </Field>
          <Field label="GitHub repo" htmlFor="pf-repo" required>
            <Input
              id="pf-repo"
              value={repo}
              onChange={(e) => handleRepoChange(e.target.value)}
              placeholder="hello-world"
              className="font-mono text-xs"
            />
          </Field>
          <Field label="Default branch" htmlFor="pf-branch" required>
            <Input
              id="pf-branch"
              value={defaultBranch}
              onChange={(e) => setDefaultBranch(e.target.value)}
              placeholder="main"
              className="font-mono text-xs"
            />
          </Field>
          <Field
            label="GitHub token (GITHUB_TOKEN)"
            htmlFor="pf-gh-token"
            hint={
              isEdit && hasSavedGithubToken
                ? "Encrypted in DB. Leave blank to keep the existing token, or paste a replacement."
                : "Encrypted at rest in DB. Optional if the server uses a host fallback token."
            }
          >
            <div className="flex gap-1.5">
              <div className="relative flex-1">
                <Input
                  id="pf-gh-token"
                  type={showGithubToken ? "text" : "password"}
                  autoComplete="off"
                  value={githubToken}
                  onChange={(e) => setGithubToken(e.target.value)}
                  placeholder={hasSavedGithubToken ? "Saved (leave blank to keep)" : "ghp_... / github_pat_..."}
                  className="pr-9 font-mono text-xs"
                />
                <button
                  type="button"
                  aria-label={showGithubToken ? "Hide token" : "Show token"}
                  onClick={() => setShowGithubToken((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showGithubToken ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!owner.trim() || !repo.trim() || testConn.isPending}
                onClick={() =>
                  testConn.mutate({
                    owner: owner.trim(),
                    repo: repo.trim(),
                    ...(githubToken.trim() ? { token: githubToken.trim() } : {}),
                    ...(initialProject ? { projectId: initialProject.id } : {}),
                  })
                }
              >
                {testConn.isPending ? "Testing…" : "Test connection"}
              </Button>
            </div>
            {testConn.data && (
              <div className={cn("mt-1.5 flex items-center gap-1.5 text-xs", testConn.data.ok ? "text-emerald-700" : "text-red-600")}>
                {testConn.data.ok ? (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                    <span>Connected as {testConn.data.login ?? "unknown"}</span>
                  </>
                ) : (
                  <>
                    <XCircle className="h-3.5 w-3.5 shrink-0" />
                    <span>{testConn.data.error ?? "Connection failed"}</span>
                  </>
                )}
              </div>
            )}
            {testConn.isError && <p className="mt-1 text-xs text-red-600">{testConn.error.message}</p>}
          </Field>
        </div>
      </Section>

      <Section
        title="Project Manifest"
        aside={
          <div className="flex items-center gap-2">
            {effectiveManifestResult?.success ? (
              <Badge variant="success">Valid manifest</Badge>
            ) : (
              <Badge variant="destructive">Invalid manifest</Badge>
            )}
            <div className="inline-flex rounded-lg border border-border bg-secondary p-0.5">
              <button
                type="button"
                onClick={() => switchManifestTab("form")}
                className={cn(
                  "inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                  manifestTab === "form" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <SlidersHorizontal className="h-3 w-3" /> Structured Form
              </button>
              <button
                type="button"
                onClick={() => switchManifestTab("json")}
                className={cn(
                  "inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                  manifestTab === "json" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Code2 className="h-3 w-3" /> Raw JSON
              </button>
            </div>
          </div>
        }
      >
        {manifestTab === "json" ? (
          <div className="flex flex-col gap-2">
            <Textarea
              aria-label="Manifest JSON"
              value={manifestJson}
              onChange={(e) => {
                setManifestJson(e.target.value);
                setManifestJsonError(null);
              }}
              rows={18}
              className="font-mono text-xs"
            />
            {manifestJsonError && (
              <p role="alert" className="text-xs text-red-600">
                {manifestJsonError}
              </p>
            )}
            {effectiveManifestResult === null && !manifestJsonError && (
              <p role="alert" className="text-xs text-red-600">
                Invalid JSON syntax.
              </p>
            )}
            {effectiveManifestResult && !effectiveManifestResult.success && (
              <p role="alert" className="text-xs text-red-600">
                {effectiveManifestResult.error.issues.map((i) => `${i.path.join(".") || "root"}: ${i.message}`).join(" · ")}
              </p>
            )}
          </div>
        ) : (
          <StructuredManifestEditor value={manifestDraft} onChange={setManifestDraft} />
        )}
      </Section>

      <Section
        title="Deploy Targets & Providers"
        aside={
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              setDeployTargets((prev) => [
                ...prev,
                {
                  target: prev.some((t) => t.target === "FE") ? "BE" : "FE",
                  provider: prev.some((t) => t.target === "FE") ? "RENDER" : "CLOUDFLARE",
                  pathPrefix: prev.some((t) => t.target === "FE") ? "be/" : "fe/",
                  url: null,
                },
              ])
            }
          >
            <Plus /> Add target
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          {liveOverlapWarnings.length > 0 && (
            <div role="alert" className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <ul className="flex flex-col gap-0.5">
                {liveOverlapWarnings.map((w) => (
                  <li key={w} className="font-mono">
                    {w}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {deployTargets.length === 0 ? (
            <p className="text-xs text-muted-foreground">No deploy targets configured. Add targets to observe post-merge deployments.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {deployTargets.map((t, idx) => (
                <div key={`${t.target}-${idx}`} className="grid items-end gap-2 rounded-lg border border-border p-3 sm:grid-cols-[7rem_9rem_1fr_1.4fr_auto]">
                  <Field label="Target" htmlFor={`dt-target-${idx}`}>
                    <select
                      id={`dt-target-${idx}`}
                      value={t.target}
                      onChange={(e) => {
                        const target = e.target.value as DeployTarget;
                        setDeployTargets((prev) => prev.map((row, i) => (i === idx ? { ...row, target } : row)));
                      }}
                      className="h-9 w-full rounded-lg border border-border bg-background px-2 text-xs"
                    >
                      {DEPLOY_TARGETS.map((dt) => (
                        <option key={dt} value={dt}>
                          {dt}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Provider" htmlFor={`dt-provider-${idx}`}>
                    <select
                      id={`dt-provider-${idx}`}
                      value={t.provider}
                      onChange={(e) => {
                        const provider = e.target.value as Provider;
                        setDeployTargets((prev) => prev.map((row, i) => (i === idx ? { ...row, provider } : row)));
                      }}
                      className="h-9 w-full rounded-lg border border-border bg-background px-2 text-xs"
                    >
                      {PROVIDERS.map((pr) => (
                        <option key={pr} value={pr}>
                          {pr}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Path prefix" htmlFor={`dt-prefix-${idx}`}>
                    <Input
                      id={`dt-prefix-${idx}`}
                      value={t.pathPrefix}
                      onChange={(e) => {
                        const pathPrefix = e.target.value;
                        setDeployTargets((prev) => prev.map((row, i) => (i === idx ? { ...row, pathPrefix } : row)));
                      }}
                      placeholder="fe/"
                      className="font-mono text-xs"
                    />
                  </Field>
                  <Field label="Public origin override" htmlFor={`dt-url-${idx}`}>
                    <Input
                      id={`dt-url-${idx}`}
                      value={t.url ?? ""}
                      onChange={(e) => {
                        const url = e.target.value || null;
                        setDeployTargets((prev) => prev.map((row, i) => (i === idx ? { ...row, url } : row)));
                      }}
                      placeholder="https://app.example.com (optional)"
                      className="font-mono text-xs"
                    />
                  </Field>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label="Remove deploy target"
                    onClick={() => setDeployTargets((prev) => prev.filter((_, i) => i !== idx))}
                  >
                    <Trash2 className="h-4 w-4 text-muted-foreground hover:text-red-600" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-border p-3">
              <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold">
                <input
                  type="checkbox"
                  checked={cfEnabled}
                  onChange={(e) => setCfEnabled(e.target.checked)}
                  className="h-4 w-4 accent-current"
                />
                Cloudflare Workers provider
              </label>
              {cfEnabled && (
                <div className="mt-3 flex flex-col gap-2">
                  <Field label="Worker name" htmlFor="pf-cf-worker" required>
                    <Input
                      id="pf-cf-worker"
                      value={cfWorkerName}
                      onChange={(e) => setCfWorkerName(e.target.value)}
                      placeholder="meme-fe"
                      className="font-mono text-xs"
                    />
                  </Field>
                  <Field label="Default origin URL" htmlFor="pf-cf-origin">
                    <Input
                      id="pf-cf-origin"
                      value={cfOrigin}
                      onChange={(e) => setCfOrigin(e.target.value)}
                      placeholder="https://meme-fe.pages.dev"
                      className="font-mono text-xs"
                    />
                  </Field>
                </div>
              )}
            </div>

            <div className="rounded-lg border border-border p-3">
              <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold">
                <input
                  type="checkbox"
                  checked={renderEnabled}
                  onChange={(e) => setRenderEnabled(e.target.checked)}
                  className="h-4 w-4 accent-current"
                />
                Render service provider
              </label>
              {renderEnabled && (
                <div className="mt-3 flex flex-col gap-2">
                  <Field label="Service ID" htmlFor="pf-render-id" required>
                    <Input
                      id="pf-render-id"
                      value={renderServiceId}
                      onChange={(e) => setRenderServiceId(e.target.value)}
                      placeholder="srv-abc123"
                      className="font-mono text-xs"
                    />
                  </Field>
                  <Field label="Default origin URL" htmlFor="pf-render-origin">
                    <Input
                      id="pf-render-origin"
                      value={renderOrigin}
                      onChange={(e) => setRenderOrigin(e.target.value)}
                      placeholder="https://api.example.com"
                      className="font-mono text-xs"
                    />
                  </Field>
                </div>
              )}
            </div>
          </div>
        </div>
      </Section>

      <Section
        title="Project Secrets"
        aside={
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <KeyRound className="h-3.5 w-3.5" /> Encrypted with AES-256-GCM
          </span>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">
            Per-project secrets are isolated per tenant and encrypted at rest in Postgres. Reference them in unit tests or E2E env as{" "}
            <span className="font-mono">@secret:NAME</span> (or <span className="font-mono">{`{ "env": "NAME" }`}</span> in JSON). Values are
            write-only.
          </p>

          {isEdit && existingSecrets.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-secondary/50 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2 font-semibold">Name</th>
                    <th className="px-3 py-2 font-semibold">Saved value</th>
                    <th className="px-3 py-2 font-semibold">Updated</th>
                    <th className="px-3 py-2 text-right font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {existingSecrets.map((secret) => (
                    <tr key={secret.name}>
                      <td className="px-3 py-2 font-mono font-medium">{secret.name}</td>
                      <td className="px-3 py-2 font-mono text-muted-foreground">{secret.hint}</td>
                      <td className="px-3 py-2 text-muted-foreground">{formatDateTime(secret.updatedAt)}</td>
                      <td className="px-3 py-2 text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={deleteSecret.isPending}
                          onClick={() => deleteSecret.mutate(secret.name)}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-red-600" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!isEdit && draftSecrets.length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {draftSecrets.map((row) => (
                <li key={row.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-1.5 text-xs">
                  <div className="flex items-center gap-3">
                    <span className="font-mono font-medium">{row.name}</span>
                    <span className="font-mono text-muted-foreground">
                      {row.value.length <= 4 ? "****" : `••••${row.value.slice(-4)}`}
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setDraftSecrets((prev) => prev.filter((r) => r.id !== row.id))}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-red-600" />
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <div className="grid items-end gap-2 sm:grid-cols-[14rem_1fr_auto]">
            <Field label={isEdit ? "Add or rotate secret" : "Secret name"} htmlFor="pf-sec-name">
              <Input
                id="pf-sec-name"
                value={newSecretName}
                onChange={(e) => setNewSecretName(e.target.value.toUpperCase())}
                placeholder="NPM_TOKEN"
                className="font-mono text-xs"
              />
            </Field>
            <Field label="Secret value" htmlFor="pf-sec-val">
              <Input
                id="pf-sec-val"
                type="password"
                autoComplete="off"
                value={newSecretValue}
                onChange={(e) => setNewSecretValue(e.target.value)}
                placeholder="Paste secret value"
                className="font-mono text-xs"
              />
            </Field>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!newSecretName.trim() || !newSecretValue || upsertSecret.isPending}
              onClick={addDraftSecret}
            >
              <Plus /> {isEdit ? (upsertSecret.isPending ? "Saving…" : "Save secret") : "Queue secret"}
            </Button>
          </div>
          {secretError && (
            <p role="alert" className="text-xs text-red-600">
              {secretError}
            </p>
          )}
        </div>
      </Section>

      <Section title="Runtime & Execution">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={`Max concurrent tasks (1–${MAX_CONCURRENT_TASKS_LIMIT})`} htmlFor="pf-max-tasks">
            <Input
              id="pf-max-tasks"
              type="number"
              min={1}
              max={MAX_CONCURRENT_TASKS_LIMIT}
              value={maxConcurrentTasks}
              onChange={(e) => setMaxConcurrentTasks(e.target.value)}
            />
          </Field>
          <Field label="Sandbox image override" htmlFor="pf-sandbox-image" hint="Leave blank to use server default.">
            <Input
              id="pf-sandbox-image"
              value={sandboxImage}
              onChange={(e) => setSandboxImage(e.target.value)}
              placeholder="sdlc-ai-sandbox:local"
              className="font-mono text-xs"
            />
          </Field>
          <Field label="Developer model override" htmlFor="pf-model-dev" hint="Leave blank to use server default.">
            <Input
              id="pf-model-dev"
              value={devModel}
              onChange={(e) => setDevModel(e.target.value)}
              placeholder="claude-sonnet-5"
              className="font-mono text-xs"
            />
          </Field>
          <Field label="Fast model override" htmlFor="pf-model-fast" hint="Leave blank to use server default.">
            <Input
              id="pf-model-fast"
              value={fastModel}
              onChange={(e) => setFastModel(e.target.value)}
              placeholder="claude-haiku-4-5-20251001"
              className="font-mono text-xs"
            />
          </Field>
        </div>
        <label htmlFor="pf-reuse-sandbox" className="mt-4 flex cursor-pointer items-center gap-2 text-sm">
          <input
            id="pf-reuse-sandbox"
            type="checkbox"
            checked={reuseSandbox}
            onChange={(e) => setReuseSandbox(e.target.checked)}
            className="h-4 w-4 accent-current"
          />
          <span>Reuse sandbox container across gates within a task</span>
        </label>
      </Section>

      {(validationError || props.submitError) && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {validationError ?? props.submitError}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2">
        {props.onCancel && (
          <Button type="button" variant="outline" onClick={props.onCancel} disabled={props.submitting}>
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={props.submitting}>
          {props.submitting ? (isEdit ? "Saving…" : "Creating…") : isEdit ? "Save changes" : "Create Project"}
        </Button>
      </div>
    </form>
  );
}

function StructuredManifestEditor({
  value,
  onChange,
}: {
  value: ProjectManifest;
  onChange: (next: ProjectManifest) => void;
}) {
  const patchRoot = (patch: Partial<ProjectManifest>) => onChange({ ...value, ...patch });

  const setStack = (key: "frontend" | "backend", enabled: boolean) => {
    if (!enabled) {
      const next = { ...value };
      delete next[key];
      onChange(next);
      return;
    }
    const defaultDir = key === "frontend" ? "fe" : "be";
    onChange({
      ...value,
      [key]: {
        dir: defaultDir,
        paths: [`${defaultDir}/**`],
        setup: [],
        checks: [],
        unitTests: null,
        integrations: [],
      },
    });
  };

  const setE2eEnabled = (enabled: boolean) => {
    patchRoot({
      e2e: enabled
        ? { command: "npm run test:e2e", cwd: ".", testDir: "e2e", env: {}, artifacts: [], optional: false }
        : null,
    });
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Root setup commands (one per line)" htmlFor="mf-root-setup">
          <Textarea
            id="mf-root-setup"
            rows={3}
            value={arrayToLines(value.setup)}
            onChange={(e) => patchRoot({ setup: linesToArray(e.target.value) })}
            placeholder="pnpm install"
            className="font-mono text-xs"
          />
        </Field>
        <Field label="Root check commands (one per line)" htmlFor="mf-root-checks">
          <Textarea
            id="mf-root-checks"
            rows={3}
            value={arrayToLines(value.checks)}
            onChange={(e) => patchRoot({ checks: linesToArray(e.target.value) })}
            placeholder="pnpm -r typecheck"
            className="font-mono text-xs"
          />
        </Field>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {(["frontend", "backend"] as const).map((key) => {
          const stack = value[key];
          return (
            <div key={key} className="rounded-lg border border-border p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide">{key} stack</span>
                <label className="flex cursor-pointer items-center gap-1.5 text-xs">
                  <input
                    type="checkbox"
                    checked={Boolean(stack)}
                    onChange={(e) => setStack(key, e.target.checked)}
                    className="h-3.5 w-3.5 accent-current"
                  />
                  Enabled
                </label>
              </div>
              {stack && (
                <StackFields
                  idPrefix={`mf-${key}`}
                  stack={stack}
                  onChange={(nextStack) => onChange({ ...value, [key]: nextStack })}
                />
              )}
            </div>
          );
        })}
      </div>

      <div className="rounded-lg border border-border p-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide">End-to-End (E2E) suite</span>
          <label className="flex cursor-pointer items-center gap-1.5 text-xs">
            <input
              type="checkbox"
              checked={Boolean(value.e2e)}
              onChange={(e) => setE2eEnabled(e.target.checked)}
              className="h-3.5 w-3.5 accent-current"
            />
            Enabled
          </label>
        </div>
        {value.e2e && <E2eFields e2e={value.e2e} onChange={(e2e) => patchRoot({ e2e })} />}
      </div>
    </div>
  );
}

function StackFields({
  idPrefix,
  stack,
  onChange,
}: {
  idPrefix: string;
  stack: StackManifest;
  onChange: (next: StackManifest) => void;
}) {
  return (
    <div className="mt-3 flex flex-col gap-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Directory" htmlFor={`${idPrefix}-dir`} required>
          <Input
            id={`${idPrefix}-dir`}
            value={stack.dir}
            onChange={(e) => onChange({ ...stack, dir: e.target.value })}
            placeholder="fe"
            className="font-mono text-xs"
          />
        </Field>
        <Field label="Owned paths (one per line)" htmlFor={`${idPrefix}-paths`}>
          <Textarea
            id={`${idPrefix}-paths`}
            rows={2}
            value={arrayToLines(stack.paths)}
            onChange={(e) => onChange({ ...stack, paths: linesToArray(e.target.value) })}
            placeholder="fe/**"
            className="font-mono text-xs"
          />
        </Field>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Setup commands" htmlFor={`${idPrefix}-setup`}>
          <Textarea
            id={`${idPrefix}-setup`}
            rows={2}
            value={arrayToLines(stack.setup)}
            onChange={(e) => onChange({ ...stack, setup: linesToArray(e.target.value) })}
            className="font-mono text-xs"
          />
        </Field>
        <Field label="Check commands" htmlFor={`${idPrefix}-checks`}>
          <Textarea
            id={`${idPrefix}-checks`}
            rows={2}
            value={arrayToLines(stack.checks)}
            onChange={(e) => onChange({ ...stack, checks: linesToArray(e.target.value) })}
            className="font-mono text-xs"
          />
        </Field>
      </div>

      <div className="rounded-md bg-secondary/40 p-2.5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium text-muted-foreground">Unit tests</span>
          <label className="flex cursor-pointer items-center gap-1.5 text-xs">
            <input
              type="checkbox"
              checked={Boolean(stack.unitTests)}
              onChange={(e) =>
                onChange({
                  ...stack,
                  unitTests: e.target.checked
                    ? { command: "npm test", cwd: stack.dir || ".", env: {}, optional: false }
                    : null,
                })
              }
              className="h-3.5 w-3.5 accent-current"
            />
            Has unit suite
          </label>
        </div>
        {stack.unitTests && (
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <Field label="Command" htmlFor={`${idPrefix}-ut-cmd`}>
              <Input
                id={`${idPrefix}-ut-cmd`}
                value={stack.unitTests.command}
                onChange={(e) =>
                  onChange({
                    ...stack,
                    unitTests: { ...stack.unitTests!, command: e.target.value },
                  })
                }
                className="font-mono text-xs"
              />
            </Field>
            <Field label="Working dir (cwd)" htmlFor={`${idPrefix}-ut-cwd`}>
              <Input
                id={`${idPrefix}-ut-cwd`}
                value={stack.unitTests.cwd}
                onChange={(e) =>
                  onChange({
                    ...stack,
                    unitTests: { ...stack.unitTests!, cwd: e.target.value },
                  })
                }
                className="font-mono text-xs"
              />
            </Field>
            <Field label="Env (KEY=val or KEY=@secret:NAME)" htmlFor={`${idPrefix}-ut-env`} className="sm:col-span-2">
              <Textarea
                id={`${idPrefix}-ut-env`}
                rows={2}
                value={envToLines(stack.unitTests.env)}
                onChange={(e) =>
                  onChange({
                    ...stack,
                    unitTests: { ...stack.unitTests!, env: linesToEnv(e.target.value) },
                  })
                }
                className="font-mono text-xs"
              />
            </Field>
            <label className="flex cursor-pointer items-center gap-1.5 text-xs sm:col-span-2">
              <input
                type="checkbox"
                checked={stack.unitTests.optional}
                onChange={(e) =>
                  onChange({
                    ...stack,
                    unitTests: { ...stack.unitTests!, optional: e.target.checked },
                  })
                }
                className="h-3.5 w-3.5 accent-current"
              />
              Optional (treat missing runner / skipped suite as pass)
            </label>
          </div>
        )}
      </div>
    </div>
  );
}

function E2eFields({ e2e, onChange }: { e2e: E2eConfig; onChange: (next: E2eConfig) => void }) {
  return (
    <div className="mt-3 grid gap-3 sm:grid-cols-3">
      <Field label="Command" htmlFor="mf-e2e-cmd" required>
        <Input
          id="mf-e2e-cmd"
          value={e2e.command}
          onChange={(e) => onChange({ ...e2e, command: e.target.value })}
          className="font-mono text-xs"
        />
      </Field>
      <Field label="Working dir (cwd)" htmlFor="mf-e2e-cwd">
        <Input
          id="mf-e2e-cwd"
          value={e2e.cwd}
          onChange={(e) => onChange({ ...e2e, cwd: e.target.value })}
          className="font-mono text-xs"
        />
      </Field>
      <Field label="Test dir" htmlFor="mf-e2e-testdir">
        <Input
          id="mf-e2e-testdir"
          value={e2e.testDir}
          onChange={(e) => onChange({ ...e2e, testDir: e.target.value })}
          className="font-mono text-xs"
        />
      </Field>
      <Field label="Artifacts (one per line)" htmlFor="mf-e2e-artifacts">
        <Textarea
          id="mf-e2e-artifacts"
          rows={2}
          value={arrayToLines(e2e.artifacts)}
          onChange={(e) => onChange({ ...e2e, artifacts: linesToArray(e.target.value) })}
          placeholder="fe/playwright-report"
          className="font-mono text-xs"
        />
      </Field>
      <Field label="Env (KEY=val or KEY=@secret:NAME)" htmlFor="mf-e2e-env" className="sm:col-span-2">
        <Textarea
          id="mf-e2e-env"
          rows={2}
          value={envToLines(e2e.env)}
          onChange={(e) => onChange({ ...e2e, env: linesToEnv(e.target.value) })}
          placeholder={"CI=1\nBASE_URL=http://localhost:5173"}
          className="font-mono text-xs"
        />
      </Field>
      <label className="flex cursor-pointer items-center gap-1.5 text-xs sm:col-span-3">
        <input
          type="checkbox"
          checked={e2e.optional}
          onChange={(e) => onChange({ ...e2e, optional: e.target.checked })}
          className="h-3.5 w-3.5 accent-current"
        />
        Optional E2E gate
      </label>
    </div>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  required,
  className,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <Label htmlFor={htmlFor} className="text-xs font-medium">
        {label}
        {required && <span className="ml-0.5 text-red-600">*</span>}
      </Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
