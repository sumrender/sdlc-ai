import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { BE_ORIGIN, createApiClient } from "./lib/api";
import { ApiProvider } from "./lib/api-context";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } },
  });
  const api = createApiClient({ origin: BE_ORIGIN });

  return createRouter({
    routeTree,
    scrollRestoration: true,
    context: { queryClient, api },
    Wrap: ({ children }) => (
      <QueryClientProvider client={queryClient}>
        <ApiProvider client={api}>{children}</ApiProvider>
      </QueryClientProvider>
    ),
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
