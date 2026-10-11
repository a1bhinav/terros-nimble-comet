# Submission

Exercise version: **v1**

Start time: Not recorded in the available session.
End time: Not recorded in the available session.

## Opportunities, ranked

Ratings describe user impact, implementation effort, and change risk.

1. **Task-completion authorization** — High impact, low effort, low risk. Implemented: prevent reps from completing teammates' tasks while preserving managers' team access.
2. **Overdue rep filtering** — High impact, low effort, low risk. Implemented: apply and validate `repId` so results match the selection and unauthorized filters fail.
3. **Concurrent completion integrity** — High impact, medium effort, low risk for the fixture repository. Implemented: prevent duplicate success and completion-timestamp overwrite.
4. **Manager summary by rep** — High impact, medium effort, medium risk. Implemented: make workload and overdue follow-ups visible before team check-ins.
5. **Independent pending actions** — Medium impact, low effort, low risk. Implemented: keep each task disabled while its own completion is pending.

## What you changed

- `7309ddb`: Check rep ownership before completion; invisible tasks return `404`. Enable overdue `repId` filtering through the existing scope resolver, including `403` for unauthorized filters.
- `00d5835`: Add a synchronous check before the fixture repository mutation. Competing completions produce one success and one `409`, preserving the winner's timestamp. Reviewed all `updateTask` callers; unrelated updates remain unrestricted.
- `a3a2976`: Replace the single pending task ID with an immutable set; each request clears only its own ID on success or failure.
- `4a1d796`: Reuse the team roster and open-task API for a manager-only summary: open/overdue counts, earliest overdue task, and reps with zero tasks. Selecting a rep opens their open tasks. Refresh after successful completion; show loading and retryable errors. Preserve account isolation through the existing token-keyed workspace and request cleanup.

## What you decided not to do

- Add a summary endpoint, shared cache, or broad refactor: the existing APIs and table styling support the MVP.
- Replace demo authentication or fixture storage: retain the documented demo scope and prioritize the focused fixes.
- Add polling, request timeouts, or change proxy settings during connectivity diagnosis: establish the runtime cause first and leave reliability enhancements separate.
- Add general task-editing restrictions to the repository: only completion atomicity was required.

## Verification

- Final `npm test`: **58 tests passed across 8 files**. The sandboxed attempt failed in Supertest's local-listener setup; rerunning with listener access passed.
- Final `npm run build`: **passed** TypeScript checking and the Vite production build.
- Regression coverage includes authorized/rejected operations; deterministic concurrent reads followed by one success and one conflict; independent task actions, failures and retries; summary aggregation, zero-task reps, filtering, refresh, loading/errors, and manager switching with loaded or delayed old responses.
- Reviewed all four commits against the domain/API docs; `git diff --check 2722e72..HEAD` passed. The working tree was clean before adding these notes. No critical defect was identified in this review.
- Manual HTTP verification: `/api/health` on `3001` returned `200` with `status: ok`; `/api/demo-accounts` through Vite on `5173` returned `200` with five accounts.
- I manually verified the manager summary, rep filtering, completion refresh, and account switching in the browser. Automated browser end-to-end tests were not performed.

## Working with AI

- Codex handled implementation and testing. ChatGPT provided independent review and challenged decisions. I made the final decisions and manually tested the application.
- Directed AI to investigate before editing, keep fixes narrow, show diffs, and add regressions before committing.
- Challenged replacing overdue `status` with `repId`. Checked `docs/api.md`, the route, and existing tests: overdue accepts `repId` and always selects open overdue tasks; `status` remains supported by the general task endpoint. Keeping both overdue filters was unnecessary.
- Rejected a test that changed `completedAt` on an already-completed task because it endorsed questionable behavior. Replaced it with a harmless non-completion update on an open task, leaving the production fix unchanged.
- Required diagnosis before changing code for “Connecting…”. Suspended API/Vite processes retained ports; direct and proxied requests connected but timed out. A second Vite instance used `5174` and forwarded to the suspended API. No speculative code change was needed. Final-review probes succeeded on normal ports; the agent did not perform server recovery.

## Remaining limitations

- Requests have no application timeout; an unresponsive server can leave “Connecting…” displayed.
- Summary data refreshes after local completion or remount, not continuously. Other users' changes and newly overdue tasks can remain stale; summary and list fetches are separate snapshots and duplicate some data transfer.
- Completion atomicity relies on one synchronous in-memory mutation. A persistent/shared store would need an atomic conditional update; fixture changes still disappear on restart, and authentication remains demo-only.
- Concurrent actions still share one error banner. Automated browser end-to-end tests were not performed.
- Exercise start/end times are unavailable; timebox compliance is unverified. Supply the complete AI work log separately; these notes do not replace it.
