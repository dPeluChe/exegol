# Review Notes — Cluster A: Agent Lifecycle

## Tasks completed
- T01: Wire git worktrees into agent spawn. Rust git2 native module built via napi-rs, integrated into AgentManager. Creates worktree before PTY spawn when `useWorktree` is checked, auto-cleans on exit if no changes.
- T03: Token usage monitor. JSONL log parser reads `~/.claude/projects/` entries, `scan` mutation imports into DB, `history` query serves raw records. TokensSection rewritten with summary cards + per-model cost breakdown.
- T11: Re-launch stopped agents. RotateCw button on AgentMiniCard for inactive agents. Spawns new agent with same config, focuses new terminal.
- T14: Per-agent process metrics. `ps -o pcpu,rss -p <pids>` called via execFileAsync for running agent PIDs. ResourcesSection table shows CPU% and Memory columns.

## What I'd improve with more time
- T03: Log parser currently scans ALL `~/.claude/projects/` directories. Should filter by matching the Exegol project path hash to the Claude Code project directory name for per-project accuracy.
- T03: Scan mutation uses `scan:<projectId>` as agentId for imported records — these don't link cleanly to real agent rows. Would benefit from a dedicated `source` column in token_usage table. (Queries updated to include scan entries via OR clause.)
- T01: Branch deletion after worktree removal isn't implemented — `removeWorktree` prunes the worktree but the branch ref remains in the repo. Would need `repo.find_branch().delete()` in Rust.

## Issues found and fixed during review
- T03: Scanned entries were invisible in UI — project queries JOINed through agents table, missing `scan:*` entries. Fixed by adding OR clause to `getProjectTokenUsageSummary` and `getProjectTokenUsage`.
- T03: No dedup on repeated scans. Fixed by checking existence (model + inputTokens + outputTokens match) before insert.
- T14: `ps` was measuring shell wrapper PID (near-zero usage), not the real CLI child process. Fixed by using `pgrep -P` to find children per parent, then aggregating parent + children metrics.
- T03: Unsafe type casts (`as number`) on potentially undefined values. Replaced with proper `typeof` checks.

## Edge cases not handled
- T01: If branch name already exists in the repo, `create_worktree` will fail and spawn falls back to project root (graceful degradation, logged)
- T01: If two agents try to create the same branch name simultaneously, second one fails (same fallback)
- T01: Worktree cleanup runs synchronously in `onExit` callback — if Rust git2 call is slow, it blocks the event loop briefly
- T03: Very large JSONL files (>100MB) will be read entirely into memory via `readFileSync`. Should use streaming for production use.
- T14: If an agent PID has already exited between the DB read and the `ps` call, `ps` returns empty/error — handled gracefully (returns empty array)

## Shared file conflicts risk
Files touched that other clusters may also modify:
- `router.ts`: NOT modified (tokenUsage + resources routers already registered)
- `queries.ts`: NOT modified (all needed queries already existed)
- `use-trpc.ts`: added `useTokenHistory`, `useTokenScan`, modified `useTokenUsageSummary` signature (lines 111-145)
- `resources.ts` (main): added `getAgentProcessMetrics()` (lines 249-275), modified `getProjectMetrics` signature (line 281)
- `resources.ts` (procedure): added `listAgents` import, `getAgentManager` import, PID collection logic (lines 21-34)
- `agent.ts` (types): added `branchName?: string` to AgentCreate
- `agent.ts` (schema): added `branchName: z.string().optional()` to agentCreateSchema

## Performance notes
- T14: `ps` is called once per `resources.project` query (every 15s). Cheap for small PID lists (<10 agents).
- T03: `scanAllLogs` reads all JSONL files synchronously in main process. For large log directories this could block for 1-2s. Consider moving to a worker thread.
- T01: Rust `create_worktree` is synchronous in napi — takes ~50ms for typical repos. `worktreeHasChanges` is also synchronous.

## New files created
- `apps/desktop/src/main/tokens/log-parser.ts` — JSONL log parser for Claude Code + Aider token usage
- `packages/core-rust/.gitignore` — Ignores .node binaries and Rust target/
- `packages/core-rust/index.js` — Generated napi-rs JS bridge (committed, needed at runtime)
- `packages/core-rust/index.d.ts` — Generated napi-rs TypeScript declarations

## New DB migrations
- None. All needed tables (worktrees, token_usage, agents) and columns (worktree_id, pid) already existed from prior migrations.

## New tRPC routes
- `tokenUsage.scan` — mutation: scans local CLI JSONL logs and imports token entries into DB
- `tokenUsage.history` — query: returns raw token_usage records for a project over last N days
