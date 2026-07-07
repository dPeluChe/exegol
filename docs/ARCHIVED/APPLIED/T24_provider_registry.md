# T24 — Agent Provider Registry

## Inspiration Source
- **Repo**: Nanobot (`github.com/HKUDS/nanobot`)
- **Files studied**: `nanobot/providers/registry.py` (ProviderSpec dataclass, static PROVIDERS tuple), `nanobot/config/schema.py` (Pydantic config)
- **Pattern applied**: Frozen spec + separate runtime config split. Static metadata (capabilities, icon, color) on the spec, user settings (custom command, env) stored in DB.
- **Repo**: ComposioHQ agent-orchestrator (`github.com/ComposioHQ/agent-orchestrator`)
- **Files studied**: `src/plugins/plugin-registry.ts`, `src/plugins/types.ts`
- **Pattern applied**: Slot-typed registry with `PluginModule` contract (manifest + create). Optional interface methods for optional capabilities. Graceful degradation when CLIs are not installed.

## What Changed
- **NEW** `apps/desktop/src/main/agents/registry.ts` — `AgentProviderRegistry` singleton with 8 builtin providers, custom provider CRUD persisted to settings table
- **MODIFIED** `apps/desktop/src/main/agents/manager.ts` — removed hardcoded `CLI_NAMES` set and `resolveCliConfig` method; now uses `getProviderRegistry()` for CLI resolution and quick-launch label detection
- **MODIFIED** `apps/desktop/src/main/ipc/procedures/agents.ts` — added `listProviders`, `registerProvider`, `unregisterProvider` tRPC procedures
- **MODIFIED** `apps/desktop/src/main/index.ts` — registry initialization on startup (`loadFromDb`)
- **MODIFIED** `apps/desktop/src/renderer/components/agents/AgentLauncher.tsx` — reads providers from tRPC `agents.listProviders` instead of hardcoded `CLI_AGENTS` array
- **MODIFIED** `packages/shared/src/types/agent.ts` — added `AgentProvider`, `AgentProviderCapabilities` types (+ types for T25, T27, T34)

## Architecture Decisions
- **Singleton registry** over dependency injection: matches existing `AgentManager` and `SchedulerEngine` patterns in the codebase
- **Custom providers persisted as JSON in settings table** rather than a new table: simple, low-migration-cost, same pattern as other settings
- **Capabilities as boolean flags** (`supportsWorktree`, `supportsResume`, etc.) rather than string arrays: provides compile-time type safety and self-documenting API
- **Backward-compatible**: existing `AgentCliConfig` in `DEFAULT_SETTINGS` is untouched; registry overlays it. Manager delegates to registry's `resolveCliConfig` which reads from the provider spec

## How to Test
- Launch the app — all 8 builtin agents should appear in the AgentLauncher dropdown
- Spawn any agent via the dropdown — should work as before
- Call `agents.registerProvider` via tRPC with a custom provider — it should appear in the launcher
- Call `agents.unregisterProvider` — custom provider should be removed
- Attempting to remove a builtin provider returns an error
- Restart the app — custom providers should persist
