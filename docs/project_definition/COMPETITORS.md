# Competitive Analysis

All data verified from primary sources (GitHub, official docs, reverse engineering). March 2026.

## Platform Comparison Matrix

| | Codex App | Superset | Cmux | Conductor.build | T3 Code | Aider | Exegol (planned) |
|---|---|---|---|---|---|---|---|
| **Type** | Desktop app | Desktop app | Desktop app | Desktop app | Web GUI | CLI tool | Desktop app |
| **Stars** | N/A (closed) | 7,208 | 5,200+ | N/A (closed) | 6,100 | 41,000+ | — |
| **License** | Proprietary | Apache 2.0 | AGPL | Proprietary | OSS | Apache 2.0 | TBD |
| **Platform** | macOS + Win | macOS (Win/Linux WIP) | macOS only | macOS only | Cross-platform | Cross-platform | macOS + Win + Linux |
| **Multi-agent** | Yes | Yes (10+) | Yes (any CLI) | Yes (Claude Code) | Yes (Codex only) | No | Yes (any CLI) |
| **Git worktrees** | Yes | Yes | No | Yes | Yes | No (auto-commit) | Yes |
| **MCP Host** | Yes | Partial (via Mastra) | No | No | No | No | Yes (native) |
| **Skills/Progressive Disclosure** | Yes (3-phase) | No | No | No | No | No | Yes (3-phase) |
| **Plan.md FSM** | No | No | No | No | No | No | Yes |
| **Repo maps (Tree-sitter)** | Yes (Rust) | No | No | No | No | Yes (Python) | Yes (Rust) |
| **Token budget/circuit breaker** | No | No | No | No | No | No | Yes |
| **OSC notifications** | No | No | Yes | No | No | No | Yes |
| **Dual mode (Architect/Editor)** | No | No | No | No | No | Yes | Yes |
| **Agent DAG visualization** | Partial (D3) | No | No | No | No | No | Yes |
| **Browser preview** | No | No | Yes (WebKit) | No | No | No | Yes |
| **Automations (background)** | Yes | No | No | No | No | No | Yes (Phase 3) |

## Stack Comparison

| | Codex App | Superset | Cmux | T3 Code | Exegol |
|---|---|---|---|---|---|
| **Shell** | Electron 40 | Electron | Swift/AppKit | Web (Bun) | Electron 41 |
| **Frontend** | React 18 + ProseMirror | React + TailwindCSS | Native (AppKit) | TypeScript + Vite | React 18 + TailwindCSS 4 |
| **Backend** | Rust (tokio, tree-sitter, rmcp) | TypeScript (tRPC, Drizzle) | Swift + libghostty | TypeScript | Rust (napi-rs, scaffold) |
| **Terminal** | node-pty | xterm.js | libghostty (GPU) | N/A | node-pty + xterm.js 6 + WebGL |
| **DB** | better-sqlite3 + sqlx-sqlite | Drizzle + Neon | N/A | N/A | libSQL (SQLite fork) |
| **Build** | Custom | Turborepo + Vite + Biome | Xcode | Turborepo + Vite | Turborepo + electron-vite 5 + Biome 2.4.7 |
| **Runtime** | Node.js | Bun | Native | Bun | Bun 1.2.0 |

## Pricing Landscape

| Platform | Model | Notes |
|----------|-------|-------|
| Codex App | $20-200/mo (ChatGPT sub) | Rate limits on all tiers |
| Superset | Free (Apache 2.0) | Pro $20/seat/mo (unclear features) |
| Cmux | Free (AGPL) | — |
| Conductor.build | Free | Pay for Claude Code separately |
| T3 Code | Free | Pay for Codex CLI separately |
| Aider | Free (Apache 2.0) | Pay for LLM API keys |
| Exegol | TBD | Users bring their own API keys |

## Weakness Map (Opportunities for Exegol)

### Codex App
- Rate limits frustrate even Pro users ($200/mo)
- GPT-only — no Claude, Gemini, or local models
- No plan.md workflow
- No token budget visibility for users
- Linux not supported

### Superset
- xterm.js performance problems
- "Converts typing time to reading time" — the review bottleneck
- 10 worktrees = 10x infrastructure (deps, DB, dev servers)
- Unclear Pro plan value
- Depends on Mastra fork (maintenance burden)

### Cmux
- macOS only
- No search across panes
- No session/process restore after restart
- No orchestration layer (just multiplexing)
- No MCP, no skills, no repo maps

### Conductor.build
- Closed source
- Claude Code only
- GitHub permissions controversy
- No sandboxing
- No plan-based workflow

### T3 Code
- Alpha quality, buggy
- Codex only (no Claude)
- Not accepting contributions
- No orchestration features

### Aider
- Not agentic (interactive only)
- diff accuracy ~70-80%
- No GUI, no multi-agent
- No MCP integration

## Market Positioning

```
                  Orchestration Power
                        ^
                        |
            Exegol ---- | ---- Codex App
           (planned)    |      (GPT-locked)
                        |
         Superset ------+
         (Electron)     |
                        |
    Conductor.build --- | --- T3 Code
    (Claude-locked)     |     (alpha)
                        |
           Cmux --------+--------- Aider
        (multiplexer)   |        (CLI only)
                        |
                        +----------------------->
                              Agent Agnosticism
```

Exegol targets the upper-right quadrant: maximum orchestration power with full agent agnosticism.

---

> **⚠️ Superseded (2026-07):** this analysis is from the project-definition era.
> Current competitive landscape: `docs/RESEARCH/COMPETITIVE_REVIEW_2026_07.md`
> and pain-point map `docs/RESEARCH/DEV_PAIN_POINTS_2026.md`.
