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

### P1.2 Terminal & Workspace — DONE
- [x] xterm.js v6 with WebGL addon
- [x] Terminal panel with fit addon (auto-resize)
- [x] Web links addon (clickable URLs)
- [x] Multi-pane tabbed workspace (WorkspaceTabBar + WorkspacePane + WorkspaceLayout)
- [x] Pane types: terminal (agent), browser (Electron webview), files (FileExplorer), empty (agent selector grid)
- [x] Tab rename via double-click, Cmd+T new tab, Cmd+W close pane, Cmd+D/Shift+D split
- [x] Pane focus with accent border
- [x] Workspace store persisted to localStorage (tabs, panes, layout tree)
- [x] Agent quick-launch bar: colored CLI icons in sidebar, agents spawn without task description
- [x] Scrollback buffer persistence (30s periodic flush + final flush on exit)
- [x] Theme support from user terminal config — font size/family configurable in settings

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

### P1.5 Diff Viewer — DONE
- [x] WorkspaceTabs includes "Diff Viewer" tab
- [x] DiffSection with unstaged/staged toggle, unified/split view modes, auto-refresh
- [x] diff-parser.ts: manual unified diff parser (files, hunks, lines with line numbers)
- [x] DiffFileView: collapsible per-file section with +/- counts, file status icons
- [x] DiffHunkView: colored diff lines (unified and split views)
- [x] Binary file detection: shows "Binary file changed" for .png, .jpg, .db, .node, etc.

### P1.6 Internal Scheduler — DONE
- [x] DB tables: scheduled_tasks, scheduled_results (with cron_expression, skill_name, cli_agent, etc.)
- [x] croner v9 dependency installed
- [x] WorkspaceTabs includes "Scheduler" tab
- [x] SchedulerEngine: cron jobs via croner, event-based completion via `onAgentComplete` callbacks (not polling)
- [x] SchedulerSection: task list with toggle/run/edit/delete, create/edit dialogs, execution history
- [x] SchedulersOverview in sidebar footer: real data (active count, next run, last result)
- [x] Concurrent execution guard, 10-minute timeout, runNow for immediate execution

### P1.7 Agent Sidebar + Live Status — DONE
- [x] Collapsible sidebar with SidebarSection component (chevron toggle, count badge, action slot)
- [x] Projects section with count badge, click to select
- [x] Recent Sessions section (collapsible)
- [x] AgentLauncher: quick-launch bar with colored CLI icons (portal dropdown, gray default, color on hover)
- [x] Agents spawn without task description (just CLI name, open empty terminal)
- [x] Empty workspace pane shows agent grid + browser + files options
- [x] Agent status parsing from stdout (currentStep live text)
- [x] Click to focus agent terminal
- [x] Agent delete via right-click context menu
- [x] StatusDot component for status indication
- [x] SidebarFooter with Schedulers + Resources overviews + version number
- [ ] Token usage mini-bar — not wired
- [ ] Active port display — not implemented
- [ ] Unread badge for agents needing attention — not implemented

### P1.8 Open in IDE — DONE
- [x] Settings: default IDE selection (vscode, cursor, zed, intellij, webstorm, custom)
- [x] Custom IDE path setting
- [x] "Open in IDE" button in sidebar project view (Code2 icon)
- [x] IDE launcher via shell PATH resolution in `main/ide/opener.ts`
- [x] Validates IDE binary exists on PATH before launching (clear error message if not found)

### P1.9 Port Detection — PLANNED
- [x] DB table: port_registry (port, source, status, worktree_id)
- [ ] No runtime port detection or UI display

### P1.10 Token Usage Monitor — DONE
- [x] DB table: token_usage with `source` column (`agent` | `log_scan`) for distinguishing scan imports from agent records (migration 012)
- [x] tRPC tokenUsage router with scan mutation (JSONL parser) and history query
- [x] WorkspaceTabs includes "Token Usage" tab
- [x] TokensSection: summary cards (cost, input/output tokens, tool calls), model cost breakdown with CSS bars
- [x] Claude Code JSONL log parser (`main/tokens/log-parser.ts`)
- [ ] Parsers for other CLIs (Codex, Aider) — not yet implemented

### P1.11 Task Viewer from Markdown — DONE
- [x] WorkspaceTabs includes "Tasks" tab
- [x] TasksSection: file picker, progress bar, interactive checkbox list with write-back
- [x] markdown-tasks.ts parser for `- [ ]`/`- [x]` tasks with depth and line tracking
- [x] Auto-probes project root on mount for: TODO.md, todo.md, TASKS.md, tasks.md, plan.md, PLAN.md
- [x] File I/O procedures: readFile, writeFile, pickFile, listDirectory (path-guarded)

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
- [x] 11 tables: projects, agents, worktrees, sessions, scheduled_tasks, scheduled_results, token_usage, port_registry, host_metrics, settings, prompts
- [x] 12 sequential migrations with tracking table (_migrations)
- [x] WAL mode
- [x] Migration 010: adds 'stopped' status to agents (table recreation)
- [x] Migration 011: adds prompts table
- [x] Migration 012: adds `source` column to token_usage (`agent` | `log_scan`)

### P1.14 Settings — DONE
- [x] SettingsPanel with 5 tabs: General, Agent CLIs, Terminal, Shortcuts, API Keys
- [x] General: default IDE, theme (dark/light/system), global hotkey
- [x] Agent CLIs: configure command + args + env for each CLI type
- [x] Terminal: font size, font family
- [x] Keyboard Shortcuts: categorized display (Navigation, Agents, Terminal)
- [x] API Keys: per-provider management with safeStorage encryption (OS keychain)
- [x] Settings persisted to DB (settings table, key-value store)
- [x] Auto-save on every change (no manual Save button needed)
- [x] IDE opener reads from user settings DB (not just project default)
- [x] Global hotkey: Cmd+Shift+E to bring app to front
- [x] Theme system: light/dark/system with CSS variables, smooth transitions for bg/color/border (xterm excluded)
- [x] Theme applies immediately (no reload), terminal colors match theme

### P1.15 Keyboard Shortcuts — DONE (added post-initial-plan)
- [x] Cmd+B: Toggle sidebar
- [x] Cmd+,: Open Settings
- [x] Cmd+Shift+P: Go to Projects
- [x] Cmd+N: New Agent
- [x] Cmd+.: Stop focused agent
- [x] Cmd+T: New workspace tab
- [x] Cmd+W: Close focused pane
- [x] Cmd+D: Split pane horizontal
- [x] Cmd+Shift+D: Split pane vertical
- [x] Cmd+]/[: Next/previous agent tab
- [x] Cmd+1-9: Switch to agent by index

### P1.16 Session Persistence — DONE (added post-initial-plan)
- [x] Zustand persist middleware saves app state to localStorage
- [x] Persisted: activeProjectId, activeView, sidebarCollapsed
- [x] Workspace store persisted: tabs, panes, layout tree
- [x] Survives app restart

### P1.17 Monaco Editor — DONE (added post-initial-plan)
- [x] Replaced custom tokenizer + Shiki with Monaco Editor (@monaco-editor/react + monaco-editor)
- [x] Read-only code viewer with VS Code-quality syntax highlighting (50+ languages)
- [x] `loader.config({ monaco })` for local loading (no CDN dependency)
- [x] CodeViewer component wraps Monaco with markdown preview toggle (react-markdown)

### P1.18 Browser Pane — DONE (added post-initial-plan)
- [x] Electron webview with URL bar
- [x] webviewTag enabled in BrowserWindow config
- [x] Focus capture overlay for unfocused browser panes
- [x] CSP updated for webview support

### P1.19 CronBuilder — DONE (added post-initial-plan)
- [x] Visual cron expression builder component for scheduler

### Future Features Discussed (Not Yet in Roadmap)
- **Skills management**: Browse/configure skill files
- **Cross-pane search**: Search text across all terminal panes

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

### P3.5 Browser Preview — PARTIAL
- [x] Embedded Electron webview as workspace pane type with URL bar
- [x] webviewTag enabled in BrowserWindow, CSP updated for webview support
- [x] Focus capture overlay for unfocused browser panes
- [ ] Agents can: capture DOM snapshots, evaluate JS, inspect console errors
- [ ] Auto-refresh on file changes in worktree
- [ ] Port management: auto-assign unique ports per worktree dev server

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
