import type { RepSummary, TaskView } from "../../shared/types";
import { formatDue } from "../format";

interface RepTaskSummaryProps {
  reps: RepSummary[];
  tasks: TaskView[];
  selectedRepId: string;
  onSelectRep: (repId: string) => void;
}

export function RepTaskSummary({ reps, tasks, selectedRepId, onSelectRep }: RepTaskSummaryProps) {
  const summaries = new Map(reps.map((rep) => [rep.id, {
    rep,
    openCount: 0,
    overdueCount: 0,
    oldestOverdue: undefined as TaskView | undefined,
  }]));

  for (const task of tasks) {
    const summary = summaries.get(task.assignee.id);
    if (!summary || task.status !== "open") continue;
    summary.openCount += 1;
    if (!task.isOverdue) continue;
    summary.overdueCount += 1;
    if (!summary.oldestOverdue || Date.parse(task.dueAt) < Date.parse(summary.oldestOverdue.dueAt)) {
      summary.oldestOverdue = task;
    }
  }

  if (reps.length === 0) {
    return <p className="state state-empty">No reps on your teams.</p>;
  }

  return (
    <table className="task-table" aria-label="Tasks by rep">
      <thead>
        <tr>
          <th scope="col">Rep</th>
          <th scope="col">Open</th>
          <th scope="col">Overdue</th>
          <th scope="col">Oldest overdue task</th>
        </tr>
      </thead>
      <tbody>
        {[...summaries.values()].map(({ rep, openCount, overdueCount, oldestOverdue }) => (
          <tr key={rep.id}>
            <td>
              <button
                type="button"
                className={rep.id === selectedRepId ? "tab-active" : undefined}
                aria-pressed={rep.id === selectedRepId}
                onClick={() => onSelectRep(rep.id)}
              >
                {rep.name}
              </button>
            </td>
            <td>{openCount}</td>
            <td>{overdueCount}</td>
            <td>
              {oldestOverdue ? (
                <>
                  {oldestOverdue.title}
                  <div className="muted">
                    {oldestOverdue.customerName} · <time dateTime={oldestOverdue.dueAt}>{formatDue(oldestOverdue.dueAt)}</time>
                  </div>
                </>
              ) : "None"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
