import type { ReactNode } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, HeadContent, Link, Outlet, Scripts } from "@tanstack/react-router";
import type { ApiClient } from "~/lib/api";
import { AppHeader } from "~/components/AppHeader";
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

const navLink = "text-sm text-muted-foreground transition-colors hover:text-foreground [&.active]:text-foreground";

function RootComponent() {
  return (
    <RootDocument>
      <div className="flex min-h-screen flex-col bg-background text-foreground">
        <AppHeader
          nav={
            <nav className="flex items-center gap-4">
              <Link to="/" className={navLink} activeOptions={{ exact: true }}>
                Kanban
              </Link>
              <Link to="/settings" className={navLink}>
                Settings
              </Link>
            </nav>
          }
        />
        <main className="flex-1">
          <Outlet />
        </main>
      </div>
    </RootDocument>
  );
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className="dark">
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
