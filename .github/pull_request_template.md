## What and why

<!-- One task per PR. What changed, and the problem it solves (a report, a log line, a task id). -->

## How it was checked

<!-- Tests added or run; for UI, what you looked at. Say what was NOT verified. -->

## Checklist

- [ ] `bun run lint`, `bun run typecheck`, `bun run test && bun run test:shared` pass
- [ ] Docs in this PR: task removed from `docs/TASK_TODO.md`, dated entry in
      `docs/TASK_COMPLETED/YYMM.md`, user-facing line in `docs/CHANGELOG.md` `[Unreleased]`
- [ ] Touched the PTY sidecar? `SIDECAR_VERSION` bumped
- [ ] New IPC/tRPC procedure? Added to `preload/capabilities.json`
- [ ] No secrets, prompts or home paths in code, logs or tests
