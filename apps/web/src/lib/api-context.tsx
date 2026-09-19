import { createContext, useContext, type ReactNode } from "react";
import type { ApiClient } from "./api";
import type { EventSourceLike } from "./event-stream";

export interface ApiContextValue {
  client: ApiClient;
  createEventSource?: (url: string) => EventSourceLike;
}

const ApiContext = createContext<ApiContextValue | null>(null);

export function ApiProvider({
  client,
  createEventSource,
  children,
}: ApiContextValue & { children: ReactNode }) {
  return <ApiContext.Provider value={{ client, createEventSource }}>{children}</ApiContext.Provider>;
}

export function useApi(): ApiContextValue {
  const value = useContext(ApiContext);
  if (!value) throw new Error("useApi must be used inside <ApiProvider>");
  return value;
}
