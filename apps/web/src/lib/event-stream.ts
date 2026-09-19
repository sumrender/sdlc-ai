import { SseMessageSchema, type SseMessage } from "@sdlc-ai/shared";

/** The subset of the browser EventSource the client relies on; injectable for tests. */
export type EventSourceLike = Pick<EventSource, "readyState" | "onopen" | "onmessage" | "onerror" | "close">;

const CLOSED = 2;

export interface EventStreamHandlers {
  onMessage(message: SseMessage): void;
  /** Fired each time a connection is re-established after a drop; callers refetch to reconcile. */
  onReconnect(): void;
  onStatus?(status: EventStreamStatus): void;
}

export type EventStreamStatus = "connecting" | "open" | "reconnecting";

export interface EventStreamOptions {
  createSource?: (url: string) => EventSourceLike;
  retryDelayMs?: number;
}

const defaultCreateSource = (url: string): EventSourceLike => new EventSource(url);

/**
 * Subscribes to the SSE endpoint, validates every message with the shared
 * schema, and keeps the connection alive: the browser retries on its own
 * while CONNECTING, and we open a fresh source when it gives up (CLOSED).
 * Returns a dispose function.
 */
export function connectEventStream(
  url: string,
  handlers: EventStreamHandlers,
  { createSource = defaultCreateSource, retryDelayMs = 2000 }: EventStreamOptions = {},
): () => void {
  let source: EventSourceLike | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  let hasOpenedBefore = false;

  const status = (s: EventStreamStatus) => handlers.onStatus?.(s);

  function open() {
    if (disposed) return;
    status(hasOpenedBefore ? "reconnecting" : "connecting");
    const next = createSource(url);
    source = next;

    next.onopen = () => {
      status("open");
      if (hasOpenedBefore) handlers.onReconnect();
      hasOpenedBefore = true;
    };

    next.onmessage = (e) => {
      const raw: unknown = e.data;
      if (typeof raw !== "string") return;
      let json: unknown;
      try {
        json = JSON.parse(raw);
      } catch {
        return;
      }
      const parsed = SseMessageSchema.safeParse(json);
      if (parsed.success) handlers.onMessage(parsed.data);
    };

    next.onerror = () => {
      if (disposed) return;
      status("reconnecting");
      if (next.readyState === CLOSED) {
        next.close();
        retryTimer = setTimeout(open, retryDelayMs);
      }
    };
  }

  open();

  return () => {
    disposed = true;
    if (retryTimer) clearTimeout(retryTimer);
    source?.close();
  };
}
