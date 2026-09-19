import { createRootRoute, Outlet } from "@tanstack/react-router";
import "../styles.css";

export const Route = createRootRoute({
  component: () => (
    <main className="min-h-screen bg-neutral-950 text-neutral-100">
      <Outlet />
    </main>
  ),
});
