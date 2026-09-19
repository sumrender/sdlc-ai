import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { BE_ORIGIN, createApiClient } from "./lib/api";
import { ApiProvider } from "./lib/api-context";
import { createFixtureApi } from "./lib/fixture-api";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } },
  });
  const fixture = import.meta.env.VITE_API_MODE === "fixture" ? createFixtureApi() : null;
  const api = fixture?.client ?? createApiClient({ origin: BE_ORIGIN });

  return createRouter({
    routeTree,
    scrollRestoration: true,
    context: { queryClient, api },
    Wrap: ({ children }) => (
      <QueryClientProvider client={queryClient}>
        <ApiProvider client={api} createEventSource={fixture?.createEventSource}>
          {children}
        </ApiProvider>
      </QueryClientProvider>
    ),
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
