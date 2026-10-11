// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TaskResponse, TaskView } from "../../shared/types";
import { api } from "../api/client";
import { TaskList } from "./TaskList";

const task: TaskView = {
  id: "task-1",
  title: "Confirm install date",
  customerName: "Patel residence",
  status: "open",
  dueAt: "2026-03-09T15:00:00.000Z",
  completedAt: null,
  isOverdue: true,
  assignee: { id: "u-marcus", name: "Marcus Bell" },
  team: { id: "team-north", name: "North Metro" },
};

const otherTask: TaskView = { ...task, id: "task-2", title: "Send revised proposal" };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function completed(task: TaskView): TaskResponse {
  return { task: { ...task, status: "completed", completedAt: "2026-03-10T15:00:00.000Z", isOverdue: false } };
}

function actionButton(task: TaskView) {
  return within(screen.getByRole("row", { name: new RegExp(task.title) })).getByRole("button");
}

function mockTaskActions() {
  const completions = new Map([task, otherTask].map((task) => [task.id, deferred<TaskResponse>()]));
  const listTasks = vi.spyOn(api, "listTasks").mockResolvedValue({ tasks: [task, otherTask] });
  const completeTask = vi.spyOn(api, "completeTask").mockImplementation((id) => completions.get(id)!.promise);
  return { completions, listTasks, completeTask };
}

function mockFetch(body: unknown, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("TaskList", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows a loading message and then the tasks", async () => {
    mockFetch({ tasks: [task] });

    render(<TaskList view="overdue" />);

    expect(screen.getByRole("status")).toHaveProperty("textContent", "Loading tasks…");
    expect(await screen.findByText("Confirm install date")).toBeTruthy();
    expect(screen.getByText("Overdue")).toBeTruthy();
  });

  it("requests the overdue endpoint with the selected rep", async () => {
    const fetchMock = mockFetch({ tasks: [task] });

    render(<TaskList view="overdue" repId="u-marcus" />);

    await screen.findByText("Confirm install date");
    expect(fetchMock).toHaveBeenCalledWith("/api/tasks/overdue?repId=u-marcus", expect.anything());
  });

  it("tells the user when there is nothing overdue", async () => {
    mockFetch({ tasks: [] });

    render(<TaskList view="overdue" />);

    expect(await screen.findByText("No overdue tasks. Everyone is caught up.")).toBeTruthy();
  });

  it("shows an error with a retry instead of the empty message when the request fails", async () => {
    const fetchMock = mockFetch({ error: { code: "internal_error", message: "Something went wrong" } }, 500);

    render(<TaskList view="overdue" />);

    expect((await screen.findByRole("alert")).textContent).toContain("Something went wrong");
    expect(screen.queryByText("No overdue tasks. Everyone is caught up.")).toBeNull();

    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ tasks: [task] }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Confirm install date")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it.each([task, otherTask])("keeps the other action pending when $title succeeds first", async (first) => {
    const remaining = first.id === task.id ? otherTask : task;
    const { completions, listTasks, completeTask } = mockTaskActions();
    const user = userEvent.setup();
    render(<TaskList view="all" status="open" />);
    await screen.findByText(task.title);

    await user.click(actionButton(task));
    await user.click(actionButton(otherTask));

    for (const pending of [task, otherTask]) {
      expect(actionButton(pending)).toHaveProperty("disabled", true);
      expect(actionButton(pending)).toHaveProperty("textContent", "Saving…");
      await user.click(actionButton(pending));
    }
    expect(completeTask).toHaveBeenCalledTimes(2);
    expect(completeTask).toHaveBeenNthCalledWith(1, task.id);
    expect(completeTask).toHaveBeenNthCalledWith(2, otherTask.id);

    listTasks.mockResolvedValue({ tasks: [remaining] });
    await act(async () => {
      completions.get(first.id)!.resolve(completed(first));
    });

    expect(screen.queryByText(first.title)).toBeNull();
    expect(actionButton(remaining)).toHaveProperty("disabled", true);
    expect(actionButton(remaining)).toHaveProperty("textContent", "Saving…");
    expect(listTasks).toHaveBeenCalledTimes(2);

    listTasks.mockResolvedValue({ tasks: [] });
    await act(async () => {
      completions.get(remaining.id)!.resolve(completed(remaining));
    });

    expect(screen.getByText("No tasks match these filters.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(listTasks).toHaveBeenCalledTimes(3);
  });

  it.each([task, otherTask])("releases only $title on failure and allows a successful retry", async (failed) => {
    const remaining = failed.id === task.id ? otherTask : task;
    const { completions, listTasks, completeTask } = mockTaskActions();
    const user = userEvent.setup();
    render(<TaskList view="all" status="open" />);
    await screen.findByText(task.title);

    await user.click(actionButton(task));
    await user.click(actionButton(otherTask));
    await act(async () => {
      completions.get(failed.id)!.reject(new Error("Connection lost"));
    });

    expect(screen.getByRole("alert").textContent).toBe(`Could not complete "${failed.title}": Connection lost`);
    expect(actionButton(failed)).toHaveProperty("disabled", false);
    expect(actionButton(failed)).toHaveProperty("textContent", "Mark complete");
    expect(actionButton(remaining)).toHaveProperty("disabled", true);
    expect(actionButton(remaining)).toHaveProperty("textContent", "Saving…");
    expect(listTasks).toHaveBeenCalledTimes(1);

    const retry = deferred<TaskResponse>();
    completeTask.mockReturnValueOnce(retry.promise);
    await user.click(actionButton(failed));

    expect(screen.queryByRole("alert")).toBeNull();
    expect(actionButton(failed)).toHaveProperty("disabled", true);
    expect(actionButton(remaining)).toHaveProperty("disabled", true);
    expect(completeTask).toHaveBeenCalledTimes(3);
    expect(completeTask).toHaveBeenLastCalledWith(failed.id);

    listTasks.mockResolvedValue({ tasks: [remaining] });
    await act(async () => {
      retry.resolve(completed(failed));
    });

    expect(screen.queryByText(failed.title)).toBeNull();
    expect(actionButton(remaining)).toHaveProperty("disabled", true);
    listTasks.mockResolvedValue({ tasks: [] });
    await act(async () => {
      completions.get(remaining.id)!.resolve(completed(remaining));
    });

    expect(screen.getByText("No tasks match these filters.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
