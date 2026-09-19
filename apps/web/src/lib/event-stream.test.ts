import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SseMessage } from "@sdlc-ai/shared";
import { connectEventStream, type EventSourceLike } from "./event-stream";
import { event } from "~/test/fixtures";

class FakeEventSource implements EventSourceLike {
  static instances: FakeEventSource[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(public readonly url: string) {
    FakeEventSource.instances.push(this);
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  send(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
  /** The browser gave up (readyState CLOSED); it will not retry on its own. */
  fail() {
    this.readyState = 2;
    this.onerror?.();
  }
  /** The browser lost the connection and is retrying on its own (readyState CONNECTING). */
  drop() {
    this.readyState = 0;
    this.onerror?.();
  }
  close() {
    this.closed = true;
    this.readyState = 2;
  }
}

describe("connectEventStream", () => {
  const received: SseMessage[] = [];
  const onReconnect = vi.fn();
  const createSource = (url: string) => new FakeEventSource(url);

  beforeEach(() => {
    vi.useFakeTimers();
    FakeEventSource.instances = [];
    received.length = 0;
    onReconnect.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it("subscribes at the given URL and delivers validated messages", () => {
    connectEventStream("http://api/events", { onMessage: (m) => received.push(m), onReconnect }, { createSource });
    const source = FakeEventSource.instances[0]!;
    source.open();

    const e = event("task-1", "TASK_STATUS_CHANGED", { status: "RUNNING" });
    source.send({ kind: "event", event: e });
    source.send({ kind: "nonsense" });
    source.send({ kind: "agent_output", taskId: "task-1", agentRunId: "run-1", testRunId: null, line: "npm ci", at: e.createdAt });

    expect(source.url).toBe("http://api/events");
    expect(received).toEqual([
      { kind: "event", event: e },
      { kind: "agent_output", taskId: "task-1", agentRunId: "run-1", testRunId: null, line: "npm ci", at: e.createdAt },
    ]);
    expect(onReconnect).not.toHaveBeenCalled();
  });

  it("reports a reconnect when the browser re-opens a dropped connection", () => {
    connectEventStream("http://api/events", { onMessage: () => {}, onReconnect }, { createSource });
    const source = FakeEventSource.instances[0]!;
    source.open();
    source.drop();
    expect(onReconnect).not.toHaveBeenCalled();

    source.open();
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });

  it("opens a fresh connection after a delay when the browser gives up, then reports a reconnect", () => {
    connectEventStream("http://api/events", { onMessage: () => {}, onReconnect }, { createSource, retryDelayMs: 1000 });
    const first = FakeEventSource.instances[0]!;
    first.open();
    first.fail();

    expect(first.closed).toBe(true);
    expect(FakeEventSource.instances).toHaveLength(1);

    vi.advanceTimersByTime(1000);
    const second = FakeEventSource.instances[1]!;
    expect(second).toBeDefined();
    second.open();
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });

  it("stops retrying once disposed", () => {
    const dispose = connectEventStream("http://api/events", { onMessage: () => {}, onReconnect }, { createSource, retryDelayMs: 1000 });
    const first = FakeEventSource.instances[0]!;
    first.fail();
    dispose();
    vi.advanceTimersByTime(5000);

    expect(first.closed).toBe(true);
    expect(FakeEventSource.instances).toHaveLength(1);
  });
});
