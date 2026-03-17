# Feature Roadmap

> **Status key**: DONE = implemented and working, PARTIAL = UI exists but functionality incomplete, STUB = placeholder UI only, PLANNED = not started

## Phase 1 — MVP Core (Weeks 1-6)

**Goal**: Execute 1+ CLI agents with terminal multiplexing, worktree isolation, and diff review.

### P1.1 Project Manager — DONE
- [x] Open local directories (folder picker via Electron dialog)
- [x] Project list with last-opened sorting
- [x] Add/remove projects, persist to libSQL
- [x] Settings per project: default IDE, default branch
- [ ] Detect git status, current branch, remote (Rust git2 scaffold exists, not wired)

### P1.2 Terminal Multiplexor — PARTIAL
- [x] xterm.js v6 with WebGL addon
- [x] Terminal tabs per agent (TerminalTabs component)
- [x] Terminal panel with fit addon (auto-resize)
- [x] Web links addon (clickable URLs)
- [ ] Split panes (vertical/horizontal) — not implemented, single terminal per agent
- [ ] Copy/paste, scrollback buffer persistence, search within pane — not implemented
- [ ] Theme support from user terminal config — font size/family configurable in settings

### P1.3 Agent Runner — DONE
- [x] Spawn any CLI agent as subprocess via node-pty through user's login shell
- [x] Supported out of box: Claude Code, Codex CLI, Gemini CLI, Aider (configured in DEFAULT_SETTINGS)
- [x] Custom CLI agents can be added via Settings > Agent CLIs
- [x] Capture stdout, pipe to xterm.js in renderer via IPC
- [x] Graceful stop (SIGTERM → 5s wait → SIGKILL fallback)
- [x] Agent status tracking: idle, spawning, running, waiting_input, paused, completed, failed, stopped
- [x] PATH resolution via login shell ($SHELL -ilc) for nvm/homebrew compatibility
- [x] Live status parsing: AgentStatusParser extracts current step from stdout
- [x] Stale agent cleanup on app startup (marks running/spawning as stopped)

### P1.4 Git Worktree Automation — PLANNED
- [ ] Rust git2 scaffold exists in packages/core-rust/ (compiles clean)
- [ ] Not yet wired into agent spawn flow — agents run in project root directory
- [ ] DB tables exist (worktrees table with auto_cleanup, disk_usage_bytes)
- [ ] Planned: create worktree per agent, auto-cleanup, branch naming

### P1.5 Diff Viewer — STUB
- [ ] WorkspaceTabs includes "Diff Viewer" tab
- [ ] DiffSection component exists as placeholder
- [ ] No diff rendering, syntax highlighting, or hunk management implemented

### P1.6 Internal Scheduler — STUB
- [x] DB tables: scheduled_tasks, scheduled_results (with cron_expression, skill_name, cli_agent, etc.)
- [x] croner v9 dependency installed
- [x] WorkspaceTabs includes "Scheduler" tab
- [x] SchedulerSection placeholder component
- [x] SchedulersOverview in sidebar footer (placeholder)
- [ ] No scheduler execution engine implemented
- [ ] No cron job running

### P1.7 Agent Sidebar + Live Status — DONE
- [x] Collapsible sidebar with SidebarSection component (chevron toggle, count badge, action slot)
- [x] Projects section with count badge, click to select
- [x] Recent Sessions section (collapsible)
- [x] New Agent button (disabled if no project selected)
- [x] SpawnAgentDialog: select CLI type + enter task description
- [x] AgentCard showing: CLI type, status, task description
- [x] Agent status parsing from stdout (currentStep live text)
- [x] Click to focus agent terminal
- [x] StatusDot component for status indication
- [x] SidebarFooter with Schedulers + Resources overviews + version number
- [ ] Token usage mini-bar — not wired
- [ ] Active port display — not implemented
- [ ] Unread badge for agents needing attention — not implemented

### P1.8 Open in IDE — PLANNED
- [x] Settings: default IDE selection (vscode, cursor, zed, intellij, webstorm, custom)
- [x] Custom IDE path setting
- [ ] Actual "open in IDE" button/action not implemented

### P1.9 Port Detection — PLANNED
- [x] DB table: port_registry (port, source, status, worktree_id)
- [ ] No runtime port detection or UI display

### P1.10 Token Usage Monitor — STUB
- [x] DB table: token_usage (agent_id, provider, model, input_tokens, output_tokens, estimated_cost_usd)
- [x] tRPC tokenUsage router exists
- [x] WorkspaceTabs includes "Token Usage" tab
- [x] TokensSection placeholder component
- [ ] No actual log parsing from CLI agents
- [ ] No real-time tracking

### P1.11 Task Viewer from Markdown — STUB
- [x] WorkspaceTabs includes "Tasks" tab
- [x] TasksSection placeholder component
- [ ] No markdown parsing or checkbox rendering

### P1.12 Host Resource Monitor — PARTIAL
- [x] Background metrics collector: CPU (delta-based), RAM (vm_stat on macOS), disk (df)
- [x] Collects every 10s, cached for synchronous reads
- [x] tRPC resources router: getSystem (cached), getProject (async du + git worktree list)
- [x] ResourcesOverview in sidebar footer
- [x] WorkspaceTabs includes "Resources" tab
- [x] ResourcesSection placeholder component in workspace
- [ ] Per-agent process metrics (PID, CPU, memory) — not implemented
- [ ] Warning thresholds — not implemented

### P1.13 SQLite State — DONE
- [x] libSQL (not better-sqlite3) in main process
- [x] 10 tables: projects, agents, worktrees, sessions, scheduled_tasks, scheduled_results, token_usage, port_registry, host_metrics, settings
- [x] 10 sequential migrations with tracking table (_migrations)
- [x] WAL mode
- [x] Migration 010: adds 'stopped' status to agents (table recreation)

### P1.14 Settings — DONE
- [x] SettingsPanel with 4 tabs: General, Agent CLIs, Terminal, Shortcuts
- [x] General: default IDE, theme (dark/light/system), global hotkey
- [x] Agent CLIs: configure command + args + env for each CLI type
- [x] Terminal: font size, font family
- [x] Keyboard Shortcuts: categorized display (Navigation, Agents, Terminal)
- [x] Settings persisted to DB (settings table, key-value store)
- [x] Save/Reset buttons with dirty state tracking
- [x] Global hotkey: Cmd+Shift+E to bring app to front
- [ ] API key management (OS keychain) — not implemented
- [ ] Theme actually applied — dark theme hardcoded

### P1.15 Keyboard Shortcuts — DONE (added post-initial-plan)
- [x] Cmd+B: Toggle sidebar
- [x] Cmd+,: Open Settings
- [x] Cmd+Shift+P: Go to Projects
- [x] Cmd+N: New Agent (open spawn dialog)
- [x] Cmd+.: Stop focused agent
- [x] Cmd+]/[: Next/previous agent tab
- [x] Cmd+1-9: Switch to agent by index

### P1.16 Session Persistence — DONE (added post-initial-plan)
- [x] Zustand persist middleware saves app state to localStorage
- [x] Persisted: activeProjectId, activeView, sidebarCollapsed
- [x] Survives app restart

### Future Features Discussed (Not Yet in Roadmap)
- **Prompts/Templates**: Pre-defined task templates per project
- **Skills management**: Browse/configure skill files
- **Terminal layouts**: Split views, multiple terminals per tab
- **File explorer panel**: Browse project files from sidebar
- **Re-launch stopped agents**: Resume agents that were stopped on app exit
- **Terminal scrollback persistence**: Save/restore terminal output across sessions

---

## Phase 2 — Intelligence Layer (Weeks 7-14)

**Goal**: Smart context management, MCP connectivity, structured planning.

### P2.1 MCP Host
- Connect to N MCP servers simultaneously
- Configuration via `.mcp.json` (compatible with Claude Code / VS Code format)
- Support both stdio (local subprocess) and Streamable HTTP (remote) transports
- Aggregate tool registry across all servers
- Tool call routing to correct server
- UI: MCP server manager (add/remove/status/reconnect)
- Security: user consent before tool execution

### P2.2 Repo Map Generator
- Tree-sitter parsing of all project files (Rust native, 165+ languages)
- Extract: function signatures, class/interface definitions, type aliases, exports
- Build dependency graph (files as nodes, references as edges)
- PageRank with personalization toward active files
- Output: compact map within configurable token budget (default 1024 tokens)
- Auto-refresh on file changes (via notify crate)
- Inject repo map into agent context on spawn

### P2.3 Skill System
- SKILL.md files with YAML frontmatter (name, description, allowed-tools, context, model)
- Progressive Disclosure: metadata → instructions → resources (3 phases)
- Scan directories: ~/.exegol/skills/, .exegol/skills/, built-in skills/
- Auto-discovery: match request semantics to skill descriptions
- Explicit invocation: /skill-name or $skill-name
- Context budget: max 2% of context window per skill
- Built-in skills: /batch, /review-pr, /debug, /plan
- Variable substitution: $ARGUMENTS, ${CLAUDE_SESSION_ID}, ${SKILL_DIR}

### P2.4 Hook System
- Register hooks on lifecycle events (PreToolUse, PostToolUse, AgentSpawn, AgentStop, etc.)
- Handler types: shell command, HTTP POST, inline function
- Exit code semantics: 0=success, 2=block, other=warning
- PreToolUse can: allow (bypass permissions), deny (prevent), ask (prompt user)
- JSON stdin/stdout for data exchange
- Configuration: .exegol/hooks.json (project) and ~/.exegol/hooks.json (global)

### P2.5 Plan.md FSM
- Create track: generate spec.md (requirements) + plan.md (task list with checkboxes)
- State machine: DRAFT → SPECIFYING → PLANNING → APPROVED → IMPLEMENTING → COMPLETE
- Agent reads plan.md, executes first unchecked item, marks complete
- Pause/resume: state persisted in file, survives app restart
- Human review gates between phases
- Track registry: .exegol/tracks.md as index of all tracks and statuses
- UI: plan viewer with progress bar, current step highlight, phase indicators

### P2.6 Layered Memory
- Priority hierarchy: managed policy > project > user > auto-memory
- CLAUDE.md / EXEGOL.md files loaded by walking up directory tree
- Path-scoped rules via .exegol/rules/*.md with glob patterns
- Auto-memory: MEMORY.md index (200 lines max), topic files on-demand
- Total memory budget: ≤10,000 tokens
- Shared memory across worktrees in same repo

### P2.7 Token Budget & Circuit Breaker
- Track per agent: input tokens, output tokens, tool calls, estimated cost
- Configurable limits: max tokens, max cost (USD), max iterations
- Warning at 80% threshold (configurable)
- Circuit breaker: graceful stop on budget exceeded
- Hook event: BudgetExceeded
- Dashboard: real-time token usage per agent with cost estimate
- Historical usage tracking in SQLite

### P2.8 Semantic Search (powered by libSQL vectors)
- **Semantic code search**: embed function/class signatures from repo map, query by meaning
  - "find the authentication logic" → matches `verifyToken()`, `authMiddleware()`, `login()`
  - Uses libSQL native F32_BLOB columns + DiskANN cosine index
- **Smart skill matching**: embed skill descriptions, match against user prompt semantically
  - Better than keyword matching for progressive disclosure activation
- **Agent memory RAG**: embed past session summaries, retrieve relevant context
  - "You solved something similar 3 days ago" with link to that session
- **Similar task detection**: when creating a new agent task, check if a past agent already did something similar
- Embeddings generated via configured model (local or API-based)
- All vectors stored in same .db file as relational data (no external vector DB)

### P2.9 Context Compaction
- Auto-trigger at ~83.5% of context window
- Summarize older conversation portions
- Re-read instructions from disk (EXEGOL.md, skills) — they survive compaction
- Customizable: users can specify what to preserve during compaction

---

## Phase 3 — Multi-Agent Orchestration (Weeks 15-22)

**Goal**: Coordinated multi-agent workflows with defined topologies.

### P3.1 Agent Topologies
- **Pipeline** (sequential): Agent A output → Agent B input → Agent C input
- **Parallel** (fan-out/fan-in): N agents work independently, results aggregated
- **Supervisor** (hierarchical): router agent delegates to specialized workers
- Topology defined in YAML config or via UI builder
- Each topology node = 1 agent + 1 worktree

### P3.2 Agent DAG Visualizer
- Interactive directed acyclic graph showing agent flow
- Node states: pending, running, waiting_input, completed, failed
- Edge labels: data flow description
- Real-time updates as agents progress
- Click node to focus that agent's terminal
- Library: D3.js or Cytoscape.js (both used by Codex)

### P3.3 Dual Mode (Architect/Editor)
- Per-agent model selection
- Architect mode: expensive model (Claude Opus, GPT-5) for planning and reasoning
- Editor mode: fast model (Claude Haiku, DeepSeek V3) for mechanical code writing
- Auto-switch: architect generates plan → editor executes steps
- Cost optimization: only use expensive tokens for thinking, cheap tokens for writing

### P3.4 AST-Based Code Edits
- ast-grep integration via Rust napi-rs
- Structure-aware: identifier renames, import management, pattern-based replacements
- Benefits: fewer tool calls, fewer tokens, deterministic edits, no formatting breakage
- Fallback: traditional text diff for unsupported languages

### P3.5 Browser Preview
- Embedded WebView for frontend preview
- Agents can: capture DOM snapshots, evaluate JS, inspect console errors
- Auto-refresh on file changes in worktree
- Split view: terminal | code diff | browser preview
- Port management: auto-assign unique ports per worktree dev server

### P3.6 Automations (Background Agents)
- Schedule agents to run tasks on cadence (daily, on-push, on-PR)
- Tasks: security scan, test coverage report, dependency audit, release notes
- Results go to inbox for human review
- State persisted in SQLite
- Memory across runs (agent writes findings to memory file)
- Requires app running (cloud execution in future phases)

### P3.7 Workspace Presets
- Per-project setup/teardown scripts
- Auto-install dependencies in new worktrees
- Environment variable templates per worktree
- Port assignment strategy
- Database provisioning (if applicable)

### P3.8 Multi-Model Router
- Configure model per agent, per skill, per topology node
- Supported providers: Anthropic, OpenAI, Google, DeepSeek, local (Ollama)
- Cost-aware routing: prefer cheaper models for simple tasks
- Fallback chain: if primary model rate-limited, try secondary

---

## Phase 4 — Polish & Scale (Weeks 23+)

### P4.1 Cross-Pane Search
- Search text across all terminal panes simultaneously
- Highlight matches, jump to pane (addresses Cmux limitation)

### P4.2 Session Restore
- Save full app state: layout, terminal sessions, agent status
- Restore after app restart (addresses Cmux limitation)
- Optional: resume agent processes if CLI supports it

### P4.3 Team Sync
- Convex backend for sharing: plans, skills, project configs
- Real-time collaboration on track reviews
- Team dashboard: who's running which agents

### P4.4 Skill Marketplace
- Browse and install community skills
- Publish custom skills
- Version management and updates

### P4.5 Telemetry Dashboard
- Token usage over time (per project, per agent, per model)
- Cost tracking with alerts
- Agent success/failure rates
- Time saved estimates

### P4.6 SQLite Snapshots
- Point-in-time backup of agent state (inspired by AgentFS but simpler)
- Restore agent to previous state
- Compare snapshots (what changed between checkpoints)

### P4.7 OSC Notifications
- Intercept OSC 9, OSC 99, OSC 777 escape sequences from agent output
- Translate to: colored ring around terminal pane, badge count in sidebar
- Native desktop notifications (Electron notification API)
- Programmatic trigger: `exegol notify "message"` CLI helper

### P4.8 Plugin API
- Extend Exegol via custom plugins
- Plugin hooks into lifecycle events
- Custom UI panels
- Distribution via npm packages
