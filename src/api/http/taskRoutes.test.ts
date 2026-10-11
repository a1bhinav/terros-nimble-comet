import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../app";
import { fixedClock, type Clock } from "../domain/clock";
import { FixtureTaskRepository } from "../repository/fixtureRepository";

const now = new Date("2026-03-10T15:00:00.000Z");
const later = new Date("2026-03-10T15:00:01.000Z");

describe("POST /api/tasks/:taskId/complete", () => {
  let app: ReturnType<typeof createApp>;
  let clock: Clock;

  beforeEach(() => {
    clock = fixedClock(now);
    app = createApp({ clock });
  });

  function complete(token: string, taskId = "task-1001") {
    return request(app).post(`/api/tasks/${taskId}/complete`).set("Authorization", `Bearer ${token}`);
  }

  it("returns one success and one conflict when both callers read the task as open", async () => {
    const findTaskById = FixtureTaskRepository.prototype.findTaskById;
    let releaseReads!: () => void;
    const bothRead = new Promise<void>((resolve) => {
      releaseReads = resolve;
    });
    const snapshots: (string | undefined)[] = [];
    vi.spyOn(FixtureTaskRepository.prototype, "findTaskById").mockImplementation(async function (this: FixtureTaskRepository, id) {
      const task = await findTaskById.call(this, id);
      snapshots.push(task?.status);
      if (snapshots.length === 2) releaseReads();
      // Neither service call may check its snapshot until both have read it.
      await bothRead;
      return task;
    });
    vi.spyOn(clock, "now").mockReturnValueOnce(now).mockReturnValue(later);

    const responses = await Promise.all([complete("demo-dana"), complete("demo-marcus")]);

    expect(snapshots).toEqual(["open", "open"]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(responses.find((response) => response.status === 409)?.body.error.code).toBe("conflict");
    const winner = responses.find((response) => response.status === 200)!;
    expect(winner.body.task).toMatchObject({ status: "completed", completedAt: now.toISOString(), isOverdue: false });

    const stored = await request(app).get("/api/tasks?status=completed").set("Authorization", "Bearer demo-marcus").expect(200);
    expect(stored.body.tasks).toContainEqual(winner.body.task);
  });

  it("allows concurrent completions of different tasks", async () => {
    const responses = await Promise.all([
      complete("demo-marcus", "task-1001"),
      complete("demo-dana", "task-1004"),
    ]);

    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(responses.map((response) => response.body.task.id)).toEqual(["task-1001", "task-1004"]);
    expect(responses.every((response) => response.body.task.status === "completed")).toBe(true);
  });

  it("returns 409 on a later retry without changing the completion timestamp", async () => {
    const first = await complete("demo-marcus").expect(200);
    vi.spyOn(clock, "now").mockReturnValue(later);

    const retry = await complete("demo-marcus").expect(409);

    expect(retry.body.error.code).toBe("conflict");
    const stored = await request(app).get("/api/tasks?status=completed").set("Authorization", "Bearer demo-marcus").expect(200);
    expect(stored.body.tasks).toContainEqual(first.body.task);
  });

  it.each([
    ["demo-marcus", "task-1004"],
    ["demo-marcus", "task-1005"],
    ["demo-marcus", "task-3001"],
    ["demo-marcus", "task-missing"],
    ["demo-dana", "task-3001"],
  ])("returns 404 for %s completing invisible or missing task %s", async (token, taskId) => {
    const response = await complete(token, taskId).expect(404);

    expect(response.body.error.code).toBe("not_found");
  });
});
