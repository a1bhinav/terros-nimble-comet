import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, ApiError, setSessionToken } from "./client";

function pendingUntilAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

describe("API request timeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setSessionToken(null);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    setSessionToken(null);
  });

  it("returns successful JSON, preserves request options, and clears its timer", async () => {
    const body = { task: { id: "task-1", status: "completed" } };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(body)));
    vi.stubGlobal("fetch", fetchMock);
    setSessionToken("demo-marcus");

    await expect(api.completeTask("task-1")).resolves.toEqual(body);

    expect(fetchMock).toHaveBeenCalledWith("/api/tasks/task-1/complete", expect.objectContaining({ method: "POST" }));
    const options = fetchMock.mock.calls[0]![1]!;
    expect(new Headers(options.headers).get("Accept")).toBe("application/json");
    expect(new Headers(options.headers).get("Authorization")).toBe("Bearer demo-marcus");
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(options.signal!.aborted).toBe(false);
  });

  it("aborts an unresponsive request at exactly 10 seconds and clears its timer", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation((_path, init) => pendingUntilAbort(init!.signal!));
    vi.stubGlobal("fetch", fetchMock);

    const result = expect(api.demoAccounts()).rejects.toThrow("Request timed out after 10 seconds. Please try again.");
    const signal = fetchMock.mock.calls[0]![1]!.signal!;

    await vi.advanceTimersByTimeAsync(9_999);
    expect(signal.aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await result;
    expect(signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([200, 500])("times out a stalled JSON body for HTTP %s instead of swallowing the abort", async (status) => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (_path, init) => {
      const response = new Response(null, { status });
      vi.spyOn(response, "json").mockImplementation(() => pendingUntilAbort(init!.signal!));
      return response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = expect(api.demoAccounts()).rejects.toThrow("Request timed out after 10 seconds. Please try again.");
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(10_000);

    await result;
    expect(fetchMock.mock.calls[0]![1]!.signal!.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves API error details and clears the timer on HTTP errors", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      error: { code: "conflict", message: "Task is already completed" },
    }), { status: 409 }));
    vi.stubGlobal("fetch", fetchMock);

    const request = api.completeTask("task-1");
    await expect(request).rejects.toBeInstanceOf(ApiError);
    await expect(request).rejects.toMatchObject({ status: 409, code: "conflict", message: "Task is already completed" });

    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchMock.mock.calls[0]![1]!.signal!.aborted).toBe(false);
  });

  it("preserves the HTTP error fallback for invalid JSON and clears the timer", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(new Response("Unavailable", { status: 503 })));

    await expect(api.demoAccounts()).rejects.toMatchObject({
      name: "ApiError", status: 503, code: "http_error", message: "Request failed (503)",
    });

    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves network errors and clears the timer", async () => {
    const error = new TypeError("Failed to fetch");
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockRejectedValue(error));

    await expect(api.demoAccounts()).rejects.toBe(error);

    expect(vi.getTimerCount()).toBe(0);
  });
});
