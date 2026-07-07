# Design Patterns

Architectural patterns extracted from ecosystem research. Each pattern includes: the source platform, what problem it solves, how it works, and how Exegol adapts it.

> **Implementation status**: Patterns 2 (worktree isolation — partial), 5 (status parsing — implemented differently via AgentStatusParser), and 9 (token budget — DB schema only) have been started. All others are planned for Phase 2+.

---

## 1. Progressive Disclosure for Context Management

**Source**: OpenAI Codex App (Skills system)
**Problem**: Loading all tool/skill descriptions into the LLM context window wastes tokens and degrades attention quality.

**How it works in Codex**:
1. **Scan**: Load only name + description from SKILL.md frontmatter (~100 tokens each)
2. **Match**: Router evaluates request semantics against descriptions, or user invokes explicitly with `$`
3. **Load**: Only when matched, read full SKILL.md + scripts + references into context

**Exegol adaptation**:
- Same 3-phase approach for skills
- Extended to MCP tools: load tool schemas lazily (only when agent's task semantics match tool description)
- Budget enforcement: max 2% of context window per skill (from Claude Code)
- Metadata cache in SQLite for fast scanning without filesystem reads

**Key metric**: Codex reported a 7M token structured session building a racing game — impossible without progressive disclosure.

---

## 2. Git Worktrees as Agent Isolation Primitive

**Source**: OpenAI Codex, Superset, Conductor.build, Claude Code
**Problem**: Multiple agents editing the same codebase cause file conflicts and state corruption.

**How it works**:
- `git worktree add` creates a new working directory linked to the same `.git`
- Each agent gets its own branch and filesystem — complete isolation
- Shared git history means worktrees are lightweight (no full clone)
- Cleanup: remove worktree + branch when agent finishes

**Exegol adaptation**:
- Auto-create worktree on agent spawn (via Rust git2)
- Auto-cleanup if no changes (from Claude Code's behavior)
- Workspace presets: auto-install deps, setup env vars per worktree (Phase 3)
- SQLite tracking of all active worktrees per project

**Known tradeoff** (from Superset feedback): N worktrees = N dependency installs, N dev servers, N DB instances. Mitigation: workspace presets with shared caches.

---

## 3. Plan.md as Finite State Machine

**Source**: Conductor for Gemini CLI
**Problem**: AI agents lose track of multi-step tasks, forget what they've done, and repeat work after interruptions.

**How it works in Conductor**:
1. `/conductor:newTrack` → generates spec.md (requirements) + plan.md (task list)
2. plan.md contains hierarchical checkboxes organized by phases
3. Agent reads plan.md, finds first `[ ]`, executes it, marks `[x]`
4. State persisted IN the file — survives crashes, restarts, context compaction
5. tracks.md serves as central registry

**Exegol adaptation**:
- Full state machine: DRAFT → SPECIFYING → PLANNING → APPROVED → IMPLEMENTING → COMPLETE
- Human review gates between phases (approve plan before implementation starts)
- PAUSED state for manual interruptions with clean resume
- Hook events: PlanStepStart, PlanStepComplete for observability
- UI: plan viewer with progress bars and phase indicators

**Key insight**: File-based state is more resilient than in-memory state. The plan is literally a serialized state machine on disk.

---

## 4. Deterministic Hooks Around Probabilistic AI

**Source**: Claude Code (Hooks system)
**Problem**: AI agents are probabilistic — they may execute dangerous commands, skip steps, or make unexpected decisions. You need guaranteed control points.

**How it works in Claude Code**:
- Hooks fire at defined lifecycle events (PreToolUse, PostToolUse, etc.)
- Handler receives JSON context via stdin, returns decision via exit code
- Exit 0 = success, Exit 2 = block (deny tool call), Other = warning
- PreToolUse can: allow (bypass permissions), deny (prevent execution), ask (prompt user)
- Can modify tool input via `updatedInput` in JSON output

**Exegol adaptation**:
- Same event-driven model with exit code semantics
- Extended events: WorktreeCreate, PlanStepStart, BudgetExceeded
- Handler types: shell command, HTTP POST (for remote integrations)
- Configuration hierarchy: project hooks override global hooks
- All hook executions logged to SQLite for auditability

**Critical principle**: Hooks are DETERMINISTIC — they always fire, always evaluate, always enforce. The AI can't skip them.

---

## 5. OSC Escape Sequence Interception

**Source**: Cmux
**Problem**: When running multiple terminal agents, you can't tell which agent needs attention, which is idle, which has failed — "attention fatigue".

**How it works in Cmux**:
- Terminal agents emit standard OSC sequences (Operating System Commands):
  - OSC 9: standard notification/bell
  - OSC 99: desktop notification
  - OSC 777: notification with custom text
- Cmux intercepts these before they reach the OS notification system
- Translates to: visual rings around panes, sidebar badges, native notifications

**Exegol adaptation**:
- Parse xterm.js output stream for OSC patterns
- Map to agent status updates in sidebar
- Desktop notification via Electron notification API
- Additional detection: parse for common patterns like "waiting for input", "error:", "FAIL"
- CLI helper: `exegol notify "message"` for programmatic notification from hooks/scripts

---

## 6. Repo Maps via Tree-sitter + PageRank

**Source**: Aider
**Problem**: Injecting full file contents into LLM context is expensive (tokens) and degrades quality (attention dilution). The "Context Window Trap".

**How it works in Aider**:
1. Tree-sitter parses all source files into ASTs (165+ languages, millisecond speed)
2. Extract definitions (where symbols are declared) and references (where used)
3. Build directed graph: files as nodes, dependency relationships as edges
4. Run PageRank with personalization toward files currently in chat context
5. Select top-ranked symbols that fit within token budget (binary search)
6. Output: compact map of file paths + signatures (no implementations)

**Result**: 4.3-6.5% context utilization vs 54-70% for brute-force agents. 4.2x fewer tokens than Claude Code.

**Exegol adaptation**:
- Rust-native implementation (Tree-sitter has first-party Rust bindings)
- Incremental updates on file changes (70% faster than full re-parse)
- Configurable token budget per agent
- Auto-inject repo map into agent context on spawn
- Cache parsed ASTs in memory, invalidate on file change events (notify crate)

---

## 7. Layered Memory Hierarchy

**Source**: Claude Code (CLAUDE.md + auto-memory)
**Problem**: Instructions scattered across files, inconsistent priority, no clear override mechanism.

**How it works in Claude Code**:
```
Priority: managed policy > project root > subdirectory > user global > auto-memory

Loading:
- Walk up directory tree from cwd, load all CLAUDE.md files found
- Subdirectory CLAUDE.md loaded on-demand when agent reads files there
- Path-scoped rules via .claude/rules/*.md with glob patterns
- Auto-memory: MEMORY.md index (first 200 lines), topic files on-demand

Survival:
- CLAUDE.md files survive context compaction (re-read from disk)
- Conversation-only instructions do NOT survive compaction
- Total budget: ≤10,000 tokens for all memory files
```

**Key finding**: Rule adherence is 92% under 200 lines but degrades to 71% past 400 lines. Keep instructions concise.

**Exegol adaptation**:
- Same hierarchy with .exegol/ namespace
- Support @import syntax for modular instructions
- Shared memory across worktrees in same repo
- Memory budget enforcement with warnings when approaching limits

---

## 8. Dual Mode: Architect + Editor

**Source**: Aider, RooCode, Windsurf
**Problem**: Using expensive frontier models for mechanical code writing wastes money. Using cheap models for complex reasoning produces bad plans.

**How it works**:
- **Architect mode**: Expensive model (Claude Opus, GPT-5, o1) analyzes the task, reasons about architecture, produces a plain-text plan with specific instructions
- **Editor mode**: Fast/cheap model (Claude Haiku, DeepSeek V3, local Ollama) takes the plan and mechanically applies code edits
- The architect never writes code. The editor never makes architectural decisions.

**Exegol adaptation**:
- Per-agent model configuration: architect model + editor model
- Auto-switch: architect generates plan steps → editor executes each step
- Fallback: if editor fails on a step, escalate back to architect
- Cost tracking shows savings vs single-model approach

---

## 9. Token Budget Circuit Breaker

**Source**: Original (derived from research on FinOps concerns in multi-agent systems)
**Problem**: Autonomous agents in loops can consume catastrophic amounts of tokens. A 3-agent squad can burn 100K+ tokens per reasoning step. No existing tool exposes budget controls to users.

**Design**:
```
Per agent:
  - maxTokens: hard limit on total tokens consumed
  - maxCost: hard limit in USD
  - maxIterations: limit on agent loop iterations
  - warningThreshold: 0.8 (alert at 80%)

Enforcement:
  - Track every API call's token usage
  - At warning threshold: surface alert in UI, log event
  - At hard limit: graceful stop (circuit breaker)
    - Save agent state for potential manual resume
    - Fire BudgetExceeded hook
    - Show summary: tokens used, cost incurred, work completed

Visibility:
  - Real-time token counter per agent in sidebar
  - Cost estimate updated live
  - Historical usage in dashboard (Phase 4)
```

---

## 10. Context Compaction Strategy

**Source**: Claude Code
**Problem**: Long conversations exceed the context window. Naive truncation loses critical instructions.

**How Claude Code handles it**:
- Auto-trigger at ~83.5% of context window (~167K of 200K)
- Server-side summarization of older conversation portions
- Critical: CLAUDE.md files are RE-READ from disk after compaction (they survive)
- Skills are also re-loaded from disk
- Conversation-only instructions are lost

**Exegol adaptation**:
- Same trigger threshold (configurable)
- All disk-based state (EXEGOL.md, skills, plan.md) survives compaction
- Plan.md FSM state survives because it's file-based (not in-memory)
- User can specify custom "preserve during compaction" rules in EXEGOL.md
- Repo map regenerated (not from memory, from actual files) after compaction

---

## Anti-Patterns to Avoid

### 1. Context Window Stuffing
**What**: Injecting all source files into the prompt.
**Why it fails**: Degrades attention mechanism, exponential cost increase, "agent amnesia" for buried instructions.
**Instead**: Use repo maps (pattern #6) — 4.3% context utilization vs 54-70%.

### 2. Monolithic Agent
**What**: One agent doing everything — reading, planning, coding, testing, deploying.
**Why it fails**: Context rot after thousands of steps. Cost spirals. Drift from original objective.
**Instead**: Supervisor topology with specialized workers. Each worker has focused context.

### 3. Framework Dependency for Orchestration
**What**: Using Mastra/LangGraph as the core orchestration engine.
**Why it fails**: Superset's Mastra fork proves the maintenance burden. Framework updates break your product.
**Instead**: Build lightweight orchestration directly. Processes + worktrees + SQLite state is simpler and under your control.

> **Exegol implementation note**: The current codebase demonstrates this — AgentManager uses node-pty + libSQL directly, with no framework dependency. tRPC over IPC (createCaller proxy traversal) avoids HTTP overhead.

### 4. Full-Clone Isolation
**What**: Cloning the entire repo for each agent.
**Why it fails**: Massive disk usage, desynchronized git history, slow setup.
**Instead**: Git worktrees — shared .git, lightweight, fast.

### 5. Static System Prompt
**What**: Injecting all instructions, tool descriptions, and context upfront.
**Why it fails**: Wastes tokens on irrelevant information. Proven by Codex's progressive disclosure approach.
**Instead**: Progressive disclosure — load only what's needed, when it's needed.
