import { beforeEach, describe, expect, it } from "vitest";

import { buildRequestContext, type RequestContext } from "../auth/requestContext";
import { createFixtureData } from "../fixtures/data";
import { FixtureDirectoryRepository, FixtureTaskRepository } from "../repository/fixtureRepository";
import { fixedClock } from "./clock";
import { createTaskQueryRegistry, TaskQueryEngine, TaskScopeResolver } from "./taskQueries";
import { TaskService } from "./taskService";

const referenceTime = new Date("2026-03-10T15:00:00.000Z");

describe("TaskService", () => {
  let directory: FixtureDirectoryRepository;
  let taskRepository: FixtureTaskRepository;
  let service: TaskService;

  async function contextFor(userId: string): Promise<RequestContext> {
    const user = await directory.findUserById(userId);
    return buildRequestContext(user!, directory);
  }

  beforeEach(() => {
    const data = createFixtureData(referenceTime);
    directory = new FixtureDirectoryRepository(data);
    taskRepository = new FixtureTaskRepository(data);
    const clock = fixedClock(referenceTime);
    const queries = new TaskQueryEngine(createTaskQueryRegistry(), new TaskScopeResolver(directory), taskRepository, clock);
    service = new TaskService(taskRepository, directory, queries, clock);
  });

  it("lists every task on the manager's team, ordered by due time", async () => {
    const tasks = await service.listTasks(await contextFor("u-dana"));

    expect(tasks.length).toBeGreaterThan(0);
    expect(new Set(tasks.map((task) => task.team.name))).toEqual(new Set(["North Metro"]));
    const dueTimes = tasks.map((task) => task.dueAt);
    expect(dueTimes).toEqual([...dueTimes].sort());
  });

  it("narrows a manager's list to a single rep", async () => {
    const tasks = await service.listTasks(await contextFor("u-dana"), { repId: "u-alicia" });

    expect(tasks.map((task) => task.assignee.name)).toEqual(Array(tasks.length).fill("Alicia Chen"));
  });

  it("shows reps only their own tasks", async () => {
    const tasks = await service.listTasks(await contextFor("u-marcus"));

    expect(tasks.map((task) => task.id)).toEqual(["task-1002", "task-1001", "task-1003"]);
  });

  it("lists a rep's overdue work", async () => {
    const tasks = await service.listOverdueTasks(await contextFor("u-marcus"));

    expect(tasks.map((task) => task.id)).toEqual(["task-1001"]);
    expect(tasks.every((task) => task.isOverdue)).toBe(true);
  });

  it.each([
    ["u-dana", "u-alicia", "task-1004"],
    ["u-dana", "u-marcus", "task-1001"],
    ["u-marcus", "u-marcus", "task-1001"],
  ])("narrows %s's overdue list to visible rep %s", async (userId, repId, taskId) => {
    const tasks = await service.listOverdueTasks(await contextFor(userId), { repId });

    expect(tasks.map((task) => task.id)).toEqual([taskId]);
    expect(tasks.every((task) => task.assignee.id === repId && task.isOverdue)).toBe(true);
  });

  it.each([
    ["u-dana", "u-kai"],
    ["u-dana", "u-missing"],
    ["u-dana", "u-dana"],
    ["u-marcus", "u-alicia"],
    ["u-marcus", "u-kai"],
  ])("rejects %s's overdue filter for unauthorized rep %s", async (userId, repId) => {
    await expect(service.listOverdueTasks(await contextFor(userId), { repId })).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it.each([
    ["u-dana", "task-1006"],
    ["u-marcus", "task-1001"],
  ])("allows %s to complete visible task %s and records the completion time", async (userId, taskId) => {
    const task = await service.completeTask(await contextFor(userId), taskId);

    expect(task.status).toBe("completed");
    expect(task.completedAt).toBe(referenceTime.toISOString());
    expect(task.isOverdue).toBe(false);
  });

  it.each([
    ["u-marcus", "task-1004"],
    ["u-marcus", "task-1005"],
    ["u-marcus", "task-3001"],
    ["u-dana", "task-3001"],
  ])("rejects %s completing invisible task %s without changing it", async (userId, taskId) => {
    const original = await taskRepository.findTaskById(taskId);

    await expect(service.completeTask(await contextFor(userId), taskId)).rejects.toMatchObject({
      code: "not_found",
    });
    expect(await taskRepository.findTaskById(taskId)).toEqual(original);
  });
});
