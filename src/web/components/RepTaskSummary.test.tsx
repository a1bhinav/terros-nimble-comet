// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RepSummary, TaskView } from "../../shared/types";
import { RepTaskSummary } from "./RepTaskSummary";

const reps: RepSummary[] = [
  { id: "rep-a", name: "Alicia", teamId: "north" },
  { id: "rep-b", name: "Marcus", teamId: "north" },
  { id: "rep-c", name: "Jordan", teamId: "south" },
];

function task(id: string, overrides: Partial<TaskView> = {}): TaskView {
  return {
    id,
    title: id,
    customerName: "Example residence",
    status: "open",
    dueAt: "2026-03-09T15:00:00.000Z",
    completedAt: null,
    isOverdue: true,
    assignee: { id: "rep-a", name: "Alicia" },
    team: { id: "north", name: "North" },
    ...overrides,
  };
}

describe("RepTaskSummary", () => {
  afterEach(cleanup);

  it("counts open tasks by rep, trusts overdue flags, and finds the earliest overdue due time", () => {
    const oldest = task("Oldest follow-up", { dueAt: "2026-03-07T15:00:00.000Z" });
    render(<RepTaskSummary reps={reps} selectedRepId="" onSelectRep={vi.fn()} tasks={[
      task("Recently overdue"),
      task("Upcoming", { isOverdue: false }),
      oldest,
      task("Completed", { status: "completed", completedAt: "2026-03-02T15:00:00.000Z", isOverdue: false }),
      task("Marcus follow-up", { assignee: { id: "rep-b", name: "Marcus" }, isOverdue: false }),
    ]} />);

    const alicia = within(screen.getByRole("row", { name: /^Alicia / }));
    expect(alicia.getAllByRole("cell").slice(0, 3).map((cell) => cell.textContent)).toEqual(["Alicia", "3", "2"]);
    expect(alicia.getByText(oldest.title)).toBeTruthy();
    expect(alicia.getAllByRole("cell")[3]!.textContent).toContain(oldest.customerName);
    expect(screen.getByRole("row", { name: /^Alicia / }).querySelector("time")?.dateTime).toBe(oldest.dueAt);
    expect(screen.queryByText("Recently overdue")).toBeNull();
    expect(within(screen.getByRole("row", { name: /^Marcus / })).getAllByRole("cell").map((cell) => cell.textContent))
      .toEqual(["Marcus", "1", "0", "None"]);
    expect(within(screen.getByRole("row", { name: /^Jordan / })).getAllByRole("cell").map((cell) => cell.textContent))
      .toEqual(["Jordan", "0", "0", "None"]);
  });

  it("selects a rep by ID and exposes the current selection", async () => {
    const onSelectRep = vi.fn();
    render(<RepTaskSummary reps={reps} tasks={[]} selectedRepId="rep-a" onSelectRep={onSelectRep} />);

    expect(screen.getByRole("button", { name: "Alicia" }).getAttribute("aria-pressed")).toBe("true");
    await userEvent.click(screen.getByRole("button", { name: "Marcus" }));

    expect(onSelectRep).toHaveBeenCalledWith("rep-b");
  });

  it("shows an empty state when the manager has no reps", () => {
    render(<RepTaskSummary reps={[]} tasks={[]} selectedRepId="" onSelectRep={vi.fn()} />);

    expect(screen.getByText("No reps on your teams.")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });
});
