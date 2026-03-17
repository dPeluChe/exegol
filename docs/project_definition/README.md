# Exegol - Project Definition

## Vision

Exegol is a desktop application for orchestrating, visualizing and managing AI development agents. It provides a unified command center where multiple CLI-based coding agents (Claude Code, OpenAI Codex, Gemini CLI, Aider, etc.) run in parallel with intelligent context management, structured planning, and full MCP connectivity.

## Problem Statement

Current AI coding tools force developers into one of two extremes:

1. **Terminal-only tools** (Claude Code, Aider) — powerful but invisible. No overview of parallel agents, no visual diffs, no coordination.
2. **Heavy platforms** (Superset, Codex App) — feature-rich but locked to specific ecosystems, with architectural limitations (xterm.js performance issues, no plan-based workflows, no repo-aware context).

No single tool combines:
- Agent-agnostic orchestration (any CLI agent)
- Structured planning (plan.md FSM with resumability)
- Intelligent context (Tree-sitter repo maps + Progressive Disclosure skills)
- Full MCP ecosystem connectivity (10,850+ servers)
- Token budget awareness with circuit breakers
- Multi-agent topologies (pipeline, parallel, supervisor)

## Target Users

- **Primary**: Software engineers using AI coding agents daily who need to run multiple agents in parallel with visibility and control
- **Secondary**: Engineering leads managing AI-assisted development workflows across teams
- **Tertiary**: Developers building custom agent workflows with MCP integrations

## Project Documents

| Document | Description |
|----------|-------------|
| [RESEARCH.md](./RESEARCH.md) | Ecosystem analysis of 10+ competing tools and technologies |
| [COMPETITORS.md](./COMPETITORS.md) | Competitive matrix with verified data |
| [STACK.md](./STACK.md) | Technology stack decisions with justifications and current versions |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Module architecture — updated to show implemented vs planned |
| [FEATURES.md](./FEATURES.md) | Feature roadmap with per-feature implementation status |
| [DESIGN_PATTERNS.md](./DESIGN_PATTERNS.md) | Key architectural patterns adopted from research |
| [../tasks_completed/2026_03.md](../tasks_completed/2026_03.md) | Work log — March 2026 |

## Current Implementation Status (March 2026)

The project has completed its first functional iteration. See [FEATURES.md](./FEATURES.md) for detailed per-feature status (DONE / PARTIAL / STUB / PLANNED).

**Working now**: Project management, agent spawning (Claude Code, Codex, Aider, Gemini), terminal emulation (xterm.js + WebGL), live agent status parsing, settings panel (4 tabs, persisted), collapsible sidebar with sections, workspace with 6 tab sections, keyboard shortcuts, session persistence, background resource monitoring, global hotkey.

**Placeholder UI**: Tasks viewer, Diff viewer, Scheduler, Token usage, Resources workspace section.

**Not started**: Git worktree automation (wiring), MCP Host, Skills, Plan FSM, Hooks, Memory system, Repo maps, Multi-agent orchestration.

## Key Differentiators (Planned)

| Exegol | What others lack |
|--------|-----------------|
| Plan.md FSM + Multi-agent orchestration | Conductor has plans but no multi-agent. Superset has multi-agent but no plans |
| MCP Host + Repo Maps + Skills in one app | Codex has Skills+MCP but no repo maps. Aider has repo maps but no MCP |
| OSC notifications + Agent DAG view | Cmux has OSC but no DAG visualization |
| Dual mode (Architect/Editor) integrated | Only in IDE extensions (RooCode), not standalone apps |
| CLI-agnostic with orchestration | Cmux is agnostic but lacks orchestration. Superset has orchestration but depends on Mastra |
| Token budget with circuit breakers | No competitor exposes this as a user-facing feature |

**Already differentiated**: CLI-agnostic agent spawning (any CLI via Settings), login shell PATH resolution for full tool compatibility.

## Research Methodology

All technical claims in these documents were verified through:
- Direct GitHub repository inspection (READMEs, source code, issues)
- Official documentation review
- Hacker News and community feedback analysis
- Reverse engineering reports (e.g., Codex App by Yangshun Tay)
- Web search across multiple sources with cross-referencing

Research conducted: March 2026
