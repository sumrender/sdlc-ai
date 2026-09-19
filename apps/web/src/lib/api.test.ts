import { describe, expect, it, vi } from "vitest";
import { ApiRequestError, createApiClient } from "./api";
import { boardTask } from "~/test/fixtures";

function fetchReturning(status: number, body: unknown) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    void input;
    void init;
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  });
}

describe("api client", () => {
  it("lists Tasks from the shared path and validates the response", async () => {
    const task = boardTask();
    const fetch = fetchReturning(200, [task]);
    const api = createApiClient({ origin: "http://api", fetch });

    await expect(api.listTasks()).resolves.toEqual([task]);
    expect(fetch.mock.calls[0]?.[0]).toBe("http://api/tasks");
  });

  it("rejects a response that does not match the shared schema", async () => {
    const api = createApiClient({ origin: "http://api", fetch: fetchReturning(200, [{ id: 1 }]) });

    await expect(api.listTasks()).rejects.toThrow(/Invalid response/);
  });

  it("posts a new Task as JSON and returns the created Task", async () => {
    const created = boardTask({ title: "Count templates" });
    const fetch = fetchReturning(201, created);
    const api = createApiClient({ origin: "http://api", fetch });

    await expect(api.createTask({ title: "Count templates", description: "" })).resolves.toEqual(created);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("http://api/tasks");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ title: "Count templates", description: "" });
  });

  it("surfaces the server's refusal reason when Start is refused", async () => {
    const api = createApiClient({
      origin: "http://api",
      fetch: fetchReturning(409, { error: "Another Task is active", code: "TASK_ACTIVE" }),
    });

    const failure = api.startTask("task-1");
    await expect(failure).rejects.toBeInstanceOf(ApiRequestError);
    await expect(failure).rejects.toMatchObject({ status: 409, message: "Another Task is active", code: "TASK_ACTIVE" });
  });

  it("answers a Question at the shared path", async () => {
    const task = boardTask();
    const fetch = fetchReturning(200, task);
    const api = createApiClient({ origin: "http://api", fetch });

    await api.answerQuestion(task.id, "question-7", { answer: "Gallery header" });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(`http://api/tasks/${task.id}/questions/question-7/answer`);
    expect(init?.method).toBe("POST");
  });
});
