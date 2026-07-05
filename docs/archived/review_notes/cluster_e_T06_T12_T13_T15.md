# Review Notes — Cluster E: Settings

## Tasks completed
- T06: Open in IDE — IDE launcher via shell PATH resolution, tRPC `projects.openInIde` mutation, `OpenInIdeButton` in sidebar project view, `useOpenInIde()` hook
- T12: Theme System — Light/Dark/System CSS variables in globals.css, `useTheme()` hook that sets `data-theme` on `<html>`, system preference listener, xterm.js dark/light terminal themes
- T13: Recent Sessions — `listRecentSessions()` DB query joining agents+projects, `agents.recentSessions` tRPC procedure, `RecentSessions.tsx` rewrite with status dots + relative time + click-to-navigate, `useRecentSessions()` hook polling 30s
- T15: API Key Management — `safeStorage`-based keystore (encrypt/decrypt with OS keychain, plaintext fallback), tRPC `apiKeys` router (list/set/delete/test), 5th "API Keys" tab in Settings, `ApiKeysSettings.tsx` with provider rows, API key injection into agent spawn env vars

## What I'd improve with more time
- T06: Validate that IDE binary exists on PATH before attempting launch (show user-friendly error)
- T12: Add smooth CSS transitions between theme changes; test all components in light theme for contrast accessibility (WCAG AA)
- T13: Add session detail view (click to expand with full task description, duration, agent output summary)
- T15: Add "Test" button that actually validates the API key with a lightweight provider-specific API call; support custom providers beyond the 3 hardcoded ones

## Edge cases not handled
- T06: If the IDE binary is not installed, the error message from execFileAsync is raw shell output; no user-friendly fallback dialog
- T12: Terminal xterm theme only updates on full terminal remount (not on live theme toggle) — acceptable since settings require save + the effect deps include `isLight`
- T13: If a project is deleted, its sessions still show in RecentSessions (the JOIN filters them, but orphaned agents in DB remain)
- T15: If `safeStorage.isEncryptionAvailable()` becomes false after keys were stored encrypted, those keys become unreadable (the "encrypted:" prefix check handles this by returning the raw value, but it would be the base64-encoded ciphertext — not the original key)

## Shared file conflicts risk
Files touched that other clusters may also modify:
- `router.ts`: added `apiKeys: apiKeysRouter` (line 16)
- `queries.ts`: added `listRecentSessions()` function and `RecentSessionRow` interface (lines 178-215)
- `use-trpc.ts`: added `useRecentSessions`, `useOpenInIde`, `useApiKeys`, `useSetApiKey`, `useDeleteApiKey` hooks (lines 90-110, 180-215)
- `SettingsPanel.tsx`: added `apikeys` tab type, `Key` icon import, `ApiKeysSettings` tab content (lines 4-21, 24, 148)
- `packages/shared/src/types/agent.ts`: added `RecentSession` type (lines 47-56)
- `agents.ts` (procedure): added `recentSessions` procedure (lines 14-19)
- `projects.ts` (procedure): added `openInIde` procedure (lines 96-115)
- `manager.ts`: added API key injection in spawn (lines 79-91, import line 10)
- `globals.css`: added `[data-theme="light"]` block (lines 36-50)
- `App.tsx`: added `useTheme()` import and call (lines 11, 37)
- `TerminalPanel.tsx`: added theme-aware terminal colors and `bg-bg-primary` (lines 26-29, 49-96, 101, 186, 204)
- `ProjectsSection.tsx`: added `OpenInIdeButton` component, `Code2` icon, `useSettings`/`useOpenInIde` imports (lines 2-5, 151-181)

## Performance notes
- RecentSessions polls at 30s — much lighter than agents (10s) or resources (10s)
- API key injection reads from SQLite on every spawn (microseconds, no concern)
- Theme changes trigger terminal re-creation (useEffect deps include `isLight`) — acceptable, infrequent operation

## New files created
- `apps/desktop/src/main/ide/opener.ts` — IDE launcher with shell PATH resolution and shell-escaped paths
- `apps/desktop/src/renderer/hooks/use-theme.ts` — Theme hook: reads settings, sets data-theme on html, listens for system preference
- `apps/desktop/src/main/security/keystore.ts` — safeStorage-based API key encryption/decryption with plaintext fallback
- `apps/desktop/src/main/ipc/procedures/apikeys.ts` — tRPC router for API key CRUD
- `apps/desktop/src/renderer/components/settings/ApiKeysSettings.tsx` — Settings tab UI for managing API keys per provider

## New DB migrations
- None — all data stored in existing `settings` table (API keys as `apikey_<provider>` key-value pairs, app settings as `app_settings` JSON)

## New tRPC routes
- `projects.openInIde` — mutation: opens a project directory in the configured IDE
- `agents.recentSessions` — query: returns last N completed/failed/stopped sessions with project info
- `apiKeys.list` — query: returns providers with hasKey flag (never exposes actual keys)
- `apiKeys.set` — mutation: encrypts and stores an API key for a provider
- `apiKeys.delete` — mutation: removes an API key for a provider
- `apiKeys.test` — mutation: checks if a key exists for a provider (placeholder for actual validation)
