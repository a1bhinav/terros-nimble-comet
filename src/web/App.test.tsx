// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CurrentUserResponse, RepSummary, TaskView } from "../shared/types";
import { App } from "./App";
import { api, setSessionToken } from "./api/client";

const manager: CurrentUserResponse = {
  user: { id: "u-dana", name: "Dana", role: "manager" },
  teams: [{ id: "north", name: "North" }],
};
const rep: CurrentUserResponse = {
  user: { id: "u-marcus", name: "Marcus", role: "rep" },
  teams: manager.teams,
};
const reps: RepSummary[] = [
  { id: "u-marcus", name: "Marcus", teamId: "north" },
  { id: "u-alicia", name: "Alicia", teamId: "north" },
];
const overdueTask: TaskView = {
  id: "task-1",
  title: "Confirm install date",
  customerName: "Patel residence",
  status: "open",
  dueAt: "2026-03-09T15:00:00.000Z",
  completedAt: null,
  isOverdue: true,
  assignee: { id: "u-marcus", name: "Marcus" },
  team: { id: "north", name: "North" },
};

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

function summaryRow(name: string) {
  const summary = screen.getByRole("region", { name: "Team summary" });
  return within(summary).getByRole("row", { name: new RegExp(`^${name} `) });
}

describe("Initial account loading", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.localStorage.clear();
    setSessionToken(null);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    window.localStorage.clear();
    setSessionToken(null);
  });

  it("shows the timeout error and loads the workspace after retry", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockImplementationOnce((_path, init) => new Promise((_resolve, reject) => {
        const signal = init!.signal!;
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ accounts: [
        { token: "demo-marcus", name: "Marcus", role: "rep", teamName: "North" },
      ] })))
      .mockResolvedValueOnce(new Response(JSON.stringify(rep)))
      .mockResolvedValueOnce(new Response(JSON.stringify({ tasks: [] })));
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);

    expect(screen.getByRole("status").textContent).toBe("Connecting…");
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });

    expect(screen.getByRole("alert").textContent).toContain("Request timed out after 10 seconds. Please try again.");
    expect(screen.queryByText("Connecting…")).toBeNull();
    expect(vi.getTimerCount()).toBe(0);

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Try again" })); });

    expect(screen.getByText("My follow-ups")).toBeTruthy();
    expect(screen.getByText("No tasks match these filters.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      "/api/demo-accounts", "/api/demo-accounts", "/api/me", "/api/tasks?status=open",
    ]);
    // Flush jsdom's zero-delay storage event from saving the selected account.
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("Manager summary", () => {
  let tasks: TaskView[];

  beforeEach(() => {
    window.localStorage.clear();
    tasks = [overdueTask, {
      ...overdueTask,
      id: "task-2",
      title: "Send revised proposal",
      assignee: { id: "u-alicia", name: "Alicia" },
      isOverdue: false,
    }];
    vi.spyOn(api, "demoAccounts").mockResolvedValue({ accounts: [
      { token: "demo-dana", name: "Dana", role: "manager", teamName: "North" },
      { token: "demo-marcus", name: "Marcus", role: "rep", teamName: "North" },
    ] });
    vi.spyOn(api, "currentUser").mockResolvedValue(manager);
    vi.spyOn(api, "teamReps").mockResolvedValue({ reps });
    vi.spyOn(api, "listTasks").mockImplementation(async (params = {}) => ({
      tasks: tasks.filter((task) => (!params.repId || task.assignee.id === params.repId) && (!params.status || task.status === params.status)),
    }));
    vi.spyOn(api, "listOverdueTasks").mockResolvedValue({ tasks: [overdueTask] });
    vi.spyOn(api, "completeTask").mockImplementation(async (id) => {
      const completed: TaskView = { ...tasks.find((task) => task.id === id)!, status: "completed", isOverdue: false, completedAt: "2026-03-10T15:00:00.000Z" };
      tasks = tasks.map((task) => task.id === id ? completed : task);
      return { task: completed };
    });
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    setSessionToken(null);
  });

  it("opens a rep's open tasks and keeps the full summary while filters change", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("table", { name: "Tasks by rep" });
    await user.selectOptions(screen.getByLabelText("Status"), "completed");
    await user.click(screen.getByRole("button", { name: "Overdue" }));
    await user.click(within(summaryRow("Marcus")).getByRole("button", { name: "Marcus" }));

    expect(screen.getByLabelText("Rep")).toHaveProperty("value", "u-marcus");
    expect(screen.getByLabelText("Status")).toHaveProperty("value", "open");
    expect(screen.getByRole("button", { name: "Tasks" }).getAttribute("aria-pressed")).toBe("true");
    expect(api.listTasks).toHaveBeenCalledWith({ repId: "u-marcus", status: "open" });
    expect(within(summaryRow("Alicia")).getAllByRole("cell").map((cell) => cell.textContent))
      .toEqual(["Alicia", "1", "0", "None"]);

    await user.selectOptions(screen.getByLabelText("Rep"), "");
    expect(await screen.findByText("Send revised proposal")).toBeTruthy();
    expect(api.teamReps).toHaveBeenCalledTimes(1);
  });

  it("does not show or fetch a manager summary for reps", async () => {
    vi.mocked(api.currentUser).mockResolvedValue(rep);
    render(<App />);
    await screen.findByText("My follow-ups");
    await screen.findByText(overdueTask.title);

    expect(screen.queryByRole("region", { name: "Team summary" })).toBeNull();
    expect(api.teamReps).not.toHaveBeenCalled();
    expect(api.listTasks).toHaveBeenCalledTimes(1);
  });

  it("refreshes the summary after completion, retaining the rep with zero tasks", async () => {
    render(<App />);
    await screen.findByRole("table", { name: "Tasks by rep" });
    const taskTable = await screen.findByRole("table", { name: "" });
    const row = within(taskTable).getByRole("row", { name: /Confirm install date/ });
    await userEvent.click(within(row).getByRole("button", { name: "Mark complete" }));

    await waitFor(() => {
      expect(within(summaryRow("Marcus")).getAllByRole("cell").map((cell) => cell.textContent))
        .toEqual(["Marcus", "0", "0", "None"]);
    });
    expect(screen.queryByText(overdueTask.title)).toBeNull();
    expect(api.completeTask).toHaveBeenCalledWith(overdueTask.id);
  });

  it("keeps summary counts when completing a task fails", async () => {
    vi.mocked(api.completeTask).mockRejectedValue(new Error("Completion failed"));
    render(<App />);
    await screen.findByRole("table", { name: "Tasks by rep" });
    const taskTable = await screen.findByRole("table", { name: "" });
    const initialLoads = vi.mocked(api.listTasks).mock.calls.length;
    await userEvent.click(within(taskTable).getAllByRole("button", { name: "Mark complete" })[0]!);

    expect((await screen.findByRole("alert")).textContent).toContain("Completion failed");
    expect(within(summaryRow("Marcus")).getAllByRole("cell").slice(0, 3).map((cell) => cell.textContent))
      .toEqual(["Marcus", "1", "1"]);
    expect(api.listTasks).toHaveBeenCalledTimes(initialLoads);
  });

  it.each(["tasks", "reps"])("shows loading until the %s request completes", async (source) => {
    const pending = gate();
    if (source === "tasks") {
      vi.mocked(api.listTasks).mockImplementation(async () => { await pending.promise; return { tasks }; });
    } else {
      vi.mocked(api.teamReps).mockImplementation(async () => { await pending.promise; return { reps }; });
    }
    render(<App />);
    const summary = await screen.findByRole("region", { name: "Team summary" });

    expect(within(summary).getByRole("status").textContent).toBe("Loading team summary…");
    expect(within(summary).queryByRole("table")).toBeNull();
    await act(async () => { pending.release(); });
    expect(within(summary).getByRole("table", { name: "Tasks by rep" })).toBeTruthy();
  });

  it.each(["tasks", "reps"])("shows and retries %s API errors instead of displaying zero counts", async (source) => {
    if (source === "tasks") {
      vi.mocked(api.listTasks).mockRejectedValue(new Error("Tasks unavailable"));
    } else {
      vi.mocked(api.teamReps).mockRejectedValue(new Error("Reps unavailable"));
    }
    render(<App />);
    const summary = await screen.findByRole("region", { name: "Team summary" });

    expect((await within(summary).findByRole("alert")).textContent).toContain("unavailable");
    expect(within(summary).queryByRole("table")).toBeNull();
    vi.mocked(api.listTasks).mockResolvedValue({ tasks });
    vi.mocked(api.teamReps).mockResolvedValue({ reps });
    await userEvent.click(within(summary).getByRole("button", { name: "Try again" }));

    expect(await within(summary).findByRole("table", { name: "Tasks by rep" })).toBeTruthy();
    expect(within(summary).queryByRole("alert")).toBeNull();
  });

  it("discards a pending manager summary when switching to a rep account", async () => {
    const pending = gate();
    vi.mocked(api.listTasks).mockImplementation(async () => { await pending.promise; return { tasks }; });
    render(<App />);
    await screen.findByRole("region", { name: "Team summary" });
    vi.mocked(api.currentUser).mockResolvedValue(rep);
    await userEvent.selectOptions(screen.getByLabelText("Signed in as"), "demo-marcus");
    await screen.findByText("My follow-ups");
    await act(async () => { pending.release(); });

    expect(screen.queryByRole("region", { name: "Team summary" })).toBeNull();
  });

  it.each(["loaded", "pending"])("discards %s data when switching between managers", async (previousState) => {
    vi.mocked(api.demoAccounts).mockResolvedValue({ accounts: [
      { token: "demo-dana", name: "Dana", role: "manager", teamName: "North" },
      { token: "demo-luis", name: "Luis", role: "manager", teamName: "South" },
    ] });
    const oldRequests = gate();
    if (previousState === "pending") {
      vi.mocked(api.teamReps).mockImplementation(async () => { await oldRequests.promise; return { reps }; });
      vi.mocked(api.listTasks).mockImplementation(async () => { await oldRequests.promise; return { tasks }; });
    }
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("region", { name: "Team summary" });
    if (previousState === "loaded") {
      await screen.findByRole("table", { name: "Tasks by rep" });
      await user.click(within(summaryRow("Marcus")).getByRole("button", { name: "Marcus" }));
    }

    const newRequests = gate();
    const southTask: TaskView = {
      ...overdueTask,
      id: "task-south",
      title: "Review South proposal",
      assignee: { id: "u-sam", name: "Sam" },
      team: { id: "south", name: "South" },
      isOverdue: false,
    };
    vi.mocked(api.currentUser).mockResolvedValue({
      user: { id: "u-luis", name: "Luis", role: "manager" },
      teams: [{ id: "south", name: "South" }],
    });
    vi.mocked(api.teamReps).mockImplementation(async () => {
      await newRequests.promise;
      return { reps: [{ id: "u-sam", name: "Sam", teamId: "south" }] };
    });
    vi.mocked(api.listTasks).mockImplementation(async () => {
      await newRequests.promise;
      return { tasks: [southTask] };
    });
    await user.selectOptions(screen.getByLabelText("Signed in as"), "demo-luis");
    await screen.findByText("South follow-ups");

    const summary = screen.getByRole("region", { name: "Team summary" });
    expect(within(summary).getByRole("status").textContent).toBe("Loading team summary…");
    expect(within(summary).queryByRole("table")).toBeNull();
    expect(screen.queryByText(overdueTask.title)).toBeNull();

    await act(async () => { newRequests.release(); });
    expect(within(summaryRow("Sam")).getAllByRole("cell").map((cell) => cell.textContent))
      .toEqual(["Sam", "1", "0", "None"]);
    expect(screen.getByLabelText("Rep")).toHaveProperty("value", "");

    // Old roster and task responses arrive after the new manager's data.
    await act(async () => { oldRequests.release(); });
    expect(within(summaryRow("Sam")).getAllByRole("cell").map((cell) => cell.textContent))
      .toEqual(["Sam", "1", "0", "None"]);
    expect(within(summary).queryByRole("button", { name: "Marcus" })).toBeNull();
    expect(screen.queryByText(overdueTask.title)).toBeNull();
    expect(screen.getByText(southTask.title)).toBeTruthy();
  });
});
