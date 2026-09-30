# Exegol — Documentation

> Documentation index and writing guidelines. Updated 2026-09-30 (README split: features and shortcuts moved to GUIDES/).

## Structure

| Location | Contents |
|----------|----------|
| `TASK_TODO.md` | **Active board** — pending tasks only, priority-ordered |
| `TASK_COMPLETED/` | Completed task archive, monthly files (`YYMM.md`) |
| `CHANGELOG.md` | Release-oriented history (what a user cares about per version) |
| `ARCHITECTURE/` | Technical architecture and capability docs |
| `PROJECT_DEFINITION/` | Vision, problem statement, stack decisions, feature roadmap (living set, created 2026-03) |
| `GUIDES/` | Features, keyboard shortcuts, release & distribution, pipeline evidence in CI |
| `RESEARCH/` | Analyses that feed the board: competitive reviews, stack reviews, audits, benchmarks |
| `AGENT_PROMPTS/` | Briefs handed to agents working in worktrees |
| `ARCHIVED/` | Obsolete docs kept for historical context (see `ARCHIVED/README.md`) |

## Key documents

| Document | What it is |
|----------|------------|
| [TASK_TODO.md](./TASK_TODO.md) | The single source of truth for pending work |
| [../CONTRIBUTING.md](../CONTRIBUTING.md) / [../AGENTS.md](../AGENTS.md) | How to contribute, for people and for AI agents |
| [RESEARCH/EXEGOL_REVIEW_2026_09_05.md](./RESEARCH/EXEGOL_REVIEW_2026_09_05.md) | Latest whole-app review feeding the board |
| [ARCHITECTURE/OWL_FLEET_WATCH.md](./ARCHITECTURE/OWL_FLEET_WATCH.md) | Dashboard fleet + Watching design |
| [RESEARCH/CODE_HEALTH_AUDIT_2026_07.md](./RESEARCH/CODE_HEALTH_AUDIT_2026_07.md) | Code audit feeding Wave 2.6 (T149–T152) |
| [RESEARCH/COMPETITIVE_REVIEW_2026_07.md](./RESEARCH/COMPETITIVE_REVIEW_2026_07.md) | Market analysis behind the moat thesis (Pipelines → Evidence → Undo → Scoring) |
| [RESEARCH/BENCHMARKS.md](./RESEARCH/BENCHMARKS.md) | Performance baselines tracked over time |
| [GUIDES/FEATURES.md](./GUIDES/FEATURES.md) | Everything the app does, by area (the README keeps the highlights) |
| [GUIDES/KEYBOARD_SHORTCUTS.md](./GUIDES/KEYBOARD_SHORTCUTS.md) | App and terminal shortcuts |
| [GUIDES/RELEASE.md](./GUIDES/RELEASE.md) | Release & distribution guide |
| [PROJECT_DEFINITION/README.md](./PROJECT_DEFINITION/README.md) | Vision + problem statement + document map |

## Writing rules

1. **No .md files at project root** except `README.md` (+ its Spanish copy `README.es.md`, kept in step), `CLAUDE.md`, `AGENTS.md` and `CONTRIBUTING.md`
2. **UPPERCASE** doc subfolders (`RESEARCH/`, not `research/`); UPPERCASE_SNAKE_CASE for new doc files
3. **TASK_TODO.md is pending-only** — completed tasks move to `TASK_COMPLETED/YYMM.md` (dated sessions), user-facing changes to `CHANGELOG.md` per version
4. **Archive, don't delete** — obsolete docs go to `ARCHIVED/` with a note in `ARCHIVED/README.md`
5. **Research feeds tasks** — analyses live in `RESEARCH/` and are cited as `Source:` by board tasks
6. **Legacy filenames inside `ARCHIVED/` keep their original casing** — link integrity from historical work logs beats convention there
