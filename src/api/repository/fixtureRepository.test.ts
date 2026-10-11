import { describe, expect, it } from "vitest";

import { createFixtureData } from "../fixtures/data";
import { FixtureTaskRepository } from "./fixtureRepository";

const now = new Date("2026-03-10T15:00:00.000Z");
const later = new Date("2026-03-10T15:00:01.000Z");

describe("FixtureTaskRepository.updateTask", () => {
  it("allows only one competing completion and preserves its timestamp", async () => {
    const repository = new FixtureTaskRepository(createFixtureData(now));

    const results = await Promise.allSettled([
      repository.updateTask("task-1001", { status: "completed", completedAt: now.toISOString() }),
      repository.updateTask("task-1001", { status: "completed", completedAt: later.toISOString() }),
    ]);

    expect(results).toMatchObject([
      { status: "fulfilled", value: { status: "completed", completedAt: now.toISOString() } },
      { status: "rejected", reason: { code: "conflict" } },
    ]);
    expect(await repository.findTaskById("task-1001")).toMatchObject({
      status: "completed",
      completedAt: now.toISOString(),
    });
  });

  it("allows a harmless non-completion update on an open task", async () => {
    const repository = new FixtureTaskRepository(createFixtureData(now));
    const original = await repository.findTaskById("task-1001");
    expect(original).toMatchObject({ status: "open", completedAt: null });

    const updated = await repository.updateTask("task-1001", { completedAt: null });

    expect(updated).toEqual(original);
    expect(await repository.findTaskById("task-1001")).toEqual(original);
  });
});
