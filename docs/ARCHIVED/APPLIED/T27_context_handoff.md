# T27 — Context Handoff on Token Limit

## Inspiration Source
- **Repo**: TunaCode (`github.com/alchemiststudiosDOTai/tunacode`)
- **Files studied**: `src/tunacode/core/compaction/controller.py`, `prompts.py`, `types.py`
- **Pattern applied**: Structured summary format (Goal, Progress, Files Touched, Next Steps, Critical Context). Threshold-based detection with idempotency guard.
- **Repo**: Stoneforge (`github.com/stoneforge-ai/stoneforge`)
- **Files studied**: `packages/smithy/src/runtime/handoff.ts`, `predecessor-query.ts`
- **Pattern applied**: HandoffContent as persisted DB document. Successor discovery via inbox. providerSessionId preservation.
- **Repo**: DeerFlow (`github.com/bytedance/deer-flow`)
- **Files studied**: `backend/docs/summarization.md`, `summarization_config.py`
- **Pattern applied**: Three-tier trigger system (tokens/messages/fraction). Protecting AI+Tool message pairs at compaction boundary.

## What Changed
- **NEW** `apps/desktop/src/main/agents/handoff.ts` — handoff DB queries, token limit detection patterns, scrollback-to-summary generator, handoff formatting for injection
- **MODIFIED** `apps/desktop/src/main/agents/status-parser.ts` — added `tokenLimitWarning` to StatusUpdate, integrates `detectTokenLimitWarning()`
- **MODIFIED** `apps/desktop/src/main/agents/manager.ts` — on token limit detection: generates handoff, stores in DB, emits `agent:handoff-ready` IPC event
- **MODIFIED** `apps/desktop/src/main/ipc/procedures/agents.ts` — added `getHandoff` query and `continueWithHandoff` mutation
- **MODIFIED** `apps/desktop/src/renderer/components/terminal/TerminalPanel.tsx` — "Continue with new agent" button on handoff, handoff summary banner, real-time handoff notification listener
- **MODIFIED** `apps/desktop/src/preload/index.ts` — exposed `onAgentHandoff`/`offAgentHandoff` IPC handlers
- **NEW** Migration 013: `handoffs` table

## Architecture Decisions
- **Heuristic extraction over LLM summarization**: v1 uses regex-based file/tool detection from scrollback. Future version can call a haiku-class model for richer summaries (gated behind API key, as DeerFlow recommends)
- **Idempotency guard**: `tokenLimitDetected` set prevents duplicate handoff creation per agent
- **Handoff as DB document**: survives crashes, visible in UI, linkable to successor via `successor_agent_id`
- **IPC push notification**: renderer gets real-time `agent:handoff-ready` event rather than polling

## How to Test
- Run an agent with a large task that approaches context limit
- When token limit patterns appear in stdout, a handoff banner should appear in the terminal panel
- Click "Continue with new agent" — a new agent spawns with the handoff context injected
- The original agent's terminal shows the handoff summary banner
- Check DB: `handoffs` table should have the summary + successor link
