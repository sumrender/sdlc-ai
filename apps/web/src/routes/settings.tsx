import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  return (
    <div className="p-6">
      <h1 className="text-lg font-semibold">Settings</h1>
      <p className="mt-2 text-sm text-muted-foreground">Project, GitHub connection, Deploy Targets, and the Project Manifest land with issue #8.</p>
    </div>
  );
}
