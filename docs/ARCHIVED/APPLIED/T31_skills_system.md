# T31 — Skills System (Markdown-Based, with Personas)

## Inspiration Source
- **Repo**: gstack (`github.com/garrytan/gstack`)
- **Files studied**: `plan-eng-review/SKILL.md.tmpl`, `qa/SKILL.md.tmpl`, `plan-ceo-review/SKILL.md.tmpl`, `scripts/gen-skill-docs.ts`, `ARCHITECTURE.md`
- **Pattern applied**: Expert persona skills with named cognitive frameworks (Brooks, Beck, Norman), YAML frontmatter, allowed-tools restriction

- **Repo**: Pi (`github.com/badlogic/pi-mono`)
- **Files studied**: `packages/coding-agent/src/core/resource-loader.ts`, `packages/coding-agent/src/core/skills.ts`
- **Pattern applied**: Dual-tier discovery (project + global), name validation, collision handling

- **Repo**: DeerFlow (`github.com/bytedance/deer-flow`)
- **Files studied**: `backend/packages/harness/deerflow/skills/loader.py`, `types.py`, `parser.py`
- **Pattern applied**: Enabled/disabled toggle per project, YAML frontmatter validation

- **Repo**: Nanobot (`github.com/HKUDS/nanobot`)
- **Files studied**: `nanobot/skills/github/SKILL.md`, `nanobot/skills/memory/SKILL.md`
- **Pattern applied**: Requirement checking (requires.bins, requires.env)

## What Changed
- `packages/shared/src/types/skill.ts` — NEW: Skill, SkillState, SkillWithState types
- `packages/shared/src/types/index.ts` — Added skill export
- `packages/shared/src/types/agent.ts` — Added `skillNames?: string[]` to AgentCreate
- `packages/shared/src/schemas/agent.ts` — Added `skillNames` to agentCreateSchema
- `apps/desktop/src/main/skills/loader.ts` — NEW: SKILL.md parser with frontmatter, requirement checking
- `apps/desktop/src/main/skills/discovery.ts` — NEW: Dual-tier discovery, default skills installation
- `apps/desktop/src/main/skills/defaults.ts` — NEW: 5 default skill contents (architect, qa, debugger, reviewer, documenter)
- `apps/desktop/src/main/db/migrations.ts` — Migration 013: skills_state table
- `apps/desktop/src/main/db/queries/skills.ts` — NEW: CRUD for per-project skill enable/disable
- `apps/desktop/src/main/db/queries.ts` — Added skills export
- `apps/desktop/src/main/ipc/procedures/skills.ts` — NEW: tRPC router (list, toggle, getContent, getEnabledForSpawn)
- `apps/desktop/src/main/ipc/router.ts` — Registered skills router
- `apps/desktop/src/main/agents/manager.ts` — Skill context injection on spawn
- `apps/desktop/src/main/index.ts` — ensureDefaultSkills() on startup
- `apps/desktop/src/renderer/hooks/use-trpc.ts` — Added useSkills, useToggleSkill, useSkillContent hooks
- `apps/desktop/src/renderer/components/workspace/WorkspaceTabs.tsx` — Added Skills tab
- `apps/desktop/src/renderer/components/workspace/WorkspaceView.tsx` — Added SkillsSection
- `apps/desktop/src/renderer/components/workspace/sections/SkillsSection.tsx` — NEW: Skills browser UI

## Architecture Decisions
- **Flat YAML frontmatter** — Used simple `key: value` format with comma-separated lists instead of nested YAML. Avoids adding a yaml parser dependency while covering all needed fields.
- **Defaults as TypeScript strings** — Default skill contents are embedded in `defaults.ts` and written to `~/.exegol/skills/` on first run. Avoids Electron resource path bundling issues and lets users edit defaults in place.
- **Project overrides global by name** — Discovery merges both tiers, with project skills taking precedence. Same pattern as Pi's dual-tier system.
- **DB tracks only enable/disable state** — Skills are discovered from filesystem; only the per-project toggle state lives in the DB. Keeps the filesystem as source of truth for skill content.
- **Skill injection via prompt prepend** — Selected skills are concatenated and prepended to the task description. Simple, works with all CLI agents.
- **Requirement checking via `command -v`** — Validates required binaries exist before marking skill as available. Unmet requirements shown in UI with warning icon.

## How to Test
1. Start the app — default skills should appear in `~/.exegol/skills/` (architect, qa, debugger, reviewer, documenter)
2. Navigate to Skills tab — all 5 defaults should be listed with role badges
3. Click expand arrow on a skill — should show content preview, allowed tools, requirements
4. Toggle a skill off — should persist across page navigation
5. Create a `.exegol/skills/custom-skill/SKILL.md` in a project dir — should appear with "project" scope icon
6. Spawn an agent with `skillNames` in the create payload — skill context should appear in the agent prompt
