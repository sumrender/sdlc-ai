import type { ReactNode } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, HeadContent, Link, Outlet, Scripts, useRouterState } from "@tanstack/react-router";
import { KanbanSquare, Settings as SettingsIcon } from "lucide-react";
import type { ApiClient } from "~/lib/api";
import { AppHeader } from "~/components/AppHeader";
import { cn } from "~/lib/utils";
import "../styles.css";

export interface RouterContext {
  queryClient: QueryClient;
  api: ApiClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "sdlc-ai" },
    ],
  }),
  component: RootComponent,
});

function RootComponent() {
  return (
    <RootDocument>
      <div className="flex min-h-screen bg-background text-foreground">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <AppHeader />
          <main className="min-w-0 flex-1">
            <Outlet />
          </main>
        </div>
      </div>
    </RootDocument>
  );
}

function Sidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const onBoard = pathname === "/";
  const onSettings = pathname.startsWith("/settings");
  const onTask = pathname.startsWith("/tasks");
  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-card md:flex">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3.5">
        <span aria-hidden className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#f6821f] text-sm font-bold text-white">
          S
        </span>
        <div className="min-w-0 leading-tight">
          <p className="truncate text-[13px] font-semibold">sdlc-ai</p>
          <p className="truncate text-[11px] text-muted-foreground">control plane</p>
        </div>
      </div>
      <nav className="flex flex-col gap-4 overflow-auto px-3 py-4 text-[13px]">
        <div>
          <p className="px-2 pb-1.5 text-[11px] font-medium text-muted-foreground">Pipeline</p>
          <div className="flex flex-col gap-0.5">
            <SideLink to="/" active={onBoard} icon={<KanbanSquare className="h-4 w-4" aria-hidden />}>
              Board
            </SideLink>
            <span
              className={cn(
                "flex cursor-default items-center gap-2.5 rounded-lg px-2.5 py-1.5",
                onTask ? "bg-secondary font-medium text-foreground" : "text-muted-foreground",
              )}
            >
              <span className="h-4 w-4" aria-hidden />
              Task detail
            </span>
          </div>
        </div>
        <div>
          <p className="px-2 pb-1.5 text-[11px] font-medium text-muted-foreground">Configure</p>
          <div className="flex flex-col gap-0.5">
            <SideLink to="/settings" active={onSettings} icon={<SettingsIcon className="h-4 w-4" aria-hidden />}>
              Settings
            </SideLink>
          </div>
        </div>
      </nav>
      <div className="mt-auto border-t border-border px-4 py-3">
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Single repo · one active task
          <br />
          Live over SSE
        </p>
      </div>
    </aside>
  );
}

function SideLink({ to, active, icon, children }: { to: string; active: boolean; icon: ReactNode; children: ReactNode }) {
  return (
    <Link
      to={to}
      className={cn(
        "flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 transition-colors hover:bg-secondary/70",
        active ? "bg-secondary font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {icon}
      {children}
    </Link>
  );
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
