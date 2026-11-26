import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import type { CreateProjectInputRaw } from "@sdlc-ai/shared";
import { ProjectForm } from "~/components/ProjectForm";
import { useCreateProject } from "~/lib/settings-query";

export const Route = createFileRoute("/projects/new")({
  component: NewProjectPage,
});

function NewProjectPage() {
  const navigate = useNavigate();
  const create = useCreateProject();

  const handleSubmit = (input: CreateProjectInputRaw) => {
    create.mutate(input, {
      onSuccess: (settings) => {
        void navigate({ to: "/projects/$slug", params: { slug: settings.project.slug } });
      },
    });
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 lg:p-6">
      <header>
        <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
          <Link to="/" className="hover:text-foreground hover:underline">
            Projects
          </Link>
          <span aria-hidden>/</span>
          <span className="font-medium text-foreground">New Project</span>
        </nav>
        <h1 className="mt-1.5 text-xl font-semibold tracking-tight">New Project</h1>
        <p className="mt-1 max-w-2xl text-[13px] text-muted-foreground">
          Register a GitHub repository, configure its build/test manifest and deploy targets, and optionally store project-scoped secrets in
          PostgreSQL.
        </p>
      </header>

      <ProjectForm
        mode="create"
        submitting={create.isPending}
        submitError={create.isError ? create.error.message : null}
        onSubmit={handleSubmit}
        onCancel={() => void navigate({ to: "/" })}
      />
    </div>
  );
}
