# T22 — Tab Recovery Tokens

## Inspiration Source
- **Repo**: Tabby (`github.com/Eugeny/tabby`)
- **Files studied**: `tabby-core/src/api/baseTabComponent.ts` (`getRecoveryToken()` interface), `tabby-core/src/services/tabRecovery.service.ts` (`TabRecoveryProvider` pattern, save/restore cycle), `tabby-terminal/src/recoveryProvider.ts` (concrete terminal recovery), `tabby-core/src/components/splitTab.component.ts` (recursive split layout serialization)
- **Pattern applied**: Each pane type produces a recovery token containing only the data needed for reconstruction. On startup, tokens are validated — deleted agents, missing files, unreachable URLs are gracefully handled with fallback UI. Tabby's `getRecoveryToken() → serialize → localStorage → recover()` cycle adapted for Zustand persist.

## What Changed
- `apps/desktop/src/renderer/stores/workspace.ts` — Added `RecoveryToken` type, `getRecoveryToken()` method, `invalidatePane()` method, `invalidReason` field on `Pane`, `onRehydrateStorage` to clear invalidReason on restart (re-validates every boot)
- `apps/desktop/src/renderer/components/workspace/WorkspacePane.tsx` — Added `RecoverableTerminalPane` (validates agent exists via `useAgent`, auto-invalidates on error), `InvalidPane` (shows reason + reset button), rendering logic checks `invalidReason` before rendering pane content

## Architecture Decisions
- **Zustand persist as recovery store**: Rather than a separate recovery mechanism, leveraged the existing Zustand persist middleware. The panes record already contains all recovery data. Added validation on restore instead of a parallel system.
- **invalidatePane + onRehydrateStorage**: Invalid panes show a message and reset button during the session. On app restart, `invalidReason` is cleared so panes are re-validated against the current DB state (agent may have been re-created).
- **RecoverableTerminalPane**: Uses `useAgent()` to validate agent exists. On fetch error (404/deleted), automatically calls `invalidatePane`. This is lazy validation — only when the pane is rendered, not upfront.
- **No WorkspaceLayout changes**: Layout tree structure already persists correctly. Recovery validation happens at the leaf (pane) level.

## How to Test
1. Open workspace with several panes (terminal, browser, files)
2. Close and reopen app — all panes should reconstruct correctly
3. Delete an agent from DB while app is closed → on restart, terminal pane shows "Agent no longer exists" with reset button
4. Click "Reset pane" → pane converts to empty state with agent launcher grid
