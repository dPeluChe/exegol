# Feature Roadmap

## Phase 1 — MVP Core (Weeks 1-6)

**Goal**: Execute 1+ CLI agents with terminal multiplexing, worktree isolation, and diff review.

### P1.1 Project Manager
- Open local git repositories
- Detect git status, current branch, remote
- Project list with recent activity
- Settings per project (CLI agent path, default model, env vars)

### P1.2 Terminal Multiplexor
- xterm.js with WebGL addon (mandatory for performance — Superset reported issues without it)
- Split panes (vertical/horizontal) with resizable dividers
- Independent terminal sessions per pane
- Copy/paste, scrollback buffer, search within pane
- Theme support (inherit from user terminal config)

### P1.3 Agent Runner
- Spawn any CLI agent as subprocess via node-pty
- Supported out of box: Claude Code, Codex CLI, Gemini CLI, Aider, OpenCode, Goose, Amp, Kiro
- Capture stdout/stderr, pipe to xterm.js
- Graceful stop (SIGTERM → SIGKILL fallback)
- Agent status tracking: idle, running, waiting_input, completed, failed

### P1.4 Git Worktree Automation
- Create worktree per agent on spawn (via Rust git2)
- Auto-generate branch name from task description
- Shared .git directory (no full clones)
- Auto-cleanup: remove worktree + branch if no changes on agent stop
- Keep worktree if changes exist, show notification

### P1.5 Diff Viewer
- Unified and split (side-by-side) views
- Per-file and per-turn diff navigation
- Syntax highlighting (Shiki)
- Accept/reject individual hunks
- Direct commit from diff viewer

### P1.6 Internal Scheduler
- Schedule agent tasks within a project using natural language prompts
- Cron-like cadence: on-demand, daily, on-push, on-PR, custom interval
- Each scheduled task = prompt + project + optional skill + optional worktree config
- Execution: spawns agent in dedicated worktree at scheduled time
- Results go to inbox panel for human review
- Persistent: survives app restart (stored in SQLite)
- UI: scheduler panel per project with list of scheduled tasks, next run, last result
- Examples:
  - "Every morning: review open PRs for security issues"
  - "On push to main: run tests and report failures"
  - "Daily: scan for deprecated dependencies"
  - "Every 2 hours: check CI pipeline status"

### P1.7 Agent Sidebar + Live Status
- Vertical tab sidebar (inspired by Cmux)
- Per agent card showing:
  - Name, CLI type icon (Claude/Codex/Gemini/Aider)
  - Git branch name
  - Status indicator: idle | spawning | running | waiting_input | paused | completed | failed
  - **Live "working on" text**: what the agent is currently doing (parsed from stdout)
    - Examples: "Writing auth middleware...", "Running tests...", "Reading src/api/routes.ts..."
    - Parsed via pattern matching on agent output (tool calls, file operations, test runs)
  - Token usage mini-bar (from P1.10)
  - Active port (from P1.9)
  - Runtime duration
- Click to focus agent terminal
- Unread badge for agents needing attention
- Per-project view: see all agents across a project with their live status at a glance

### P1.8 Open in IDE
- One-click open any worktree in user's preferred IDE
- Auto-detect installed IDEs: VS Code, Cursor, Zed, JetBrains (IntelliJ, WebStorm, etc.)
- Configurable default IDE per project
- Opens at worktree root with correct working directory

### P1.9 Port Detection
- Parse project configs to detect configured ports: vite.config, next.config, package.json scripts, .env
- Monitor active listening ports per worktree (via `lsof` / `ss`)
- Display in agent sidebar: port number + status (listening/idle)
- Click port → open in browser or embedded preview
- Conflict detection: warn when two worktrees try to use same port

### P1.10 Token Usage Monitor (built-in, no external app)
- Read local JSONL logs from CLI agents:
  - Claude Code: `~/.claude/projects/**/` JSONL files
  - Codex CLI: local session logs
  - Gemini CLI: CLI RPC / log files
  - Aider: session cost logs
- Parse and aggregate: input tokens, output tokens, cost estimate
- Real-time display per agent in sidebar (mini progress bar)
- 30-day rolling history stored in SQLite
- No external app needed (replaces CodexBar, ccusage, tokscale)
- Inspired by: [steipete/CodexBar](https://github.com/steipete/CodexBar), [ryoppippi/ccusage](https://github.com/ryoppippi/ccusage), [mag123c/toktrack](https://github.com/mag123c/toktrack)

### P1.11 Task Viewer from Markdown
- Load any .md file containing checkbox tasks (`- [ ]` / `- [x]`)
- Render as visual task list with progress indicators
- Toggle checkboxes from UI → updates the .md file on disk
- Support nested tasks (indented checkboxes)
- Works with: plan.md, TODO.md, any user markdown file
- Drag to reorder tasks (updates file)
- Filter: show all / pending / completed

### P1.12 Host Resource Monitor
- Per-project resource usage: CPU %, RAM, disk space used by worktrees
- Per-agent process metrics: PID, CPU, memory, runtime duration
- Total disk usage per project (all worktrees combined)
- Warning when disk usage exceeds threshold (worktree accumulation)
- Display in project overview panel

### P1.13 SQLite State
- better-sqlite3 in main process
- Tables: projects, agents, worktrees, sessions, token_usage, port_registry
- WAL mode for concurrent reads
- Automatic schema migrations

### P1.14 Settings
- API key management (stored in OS keychain, not plaintext)
- CLI agent paths configuration
- Default IDE selection
- Theme selection (dark/light + custom)
- Keyboard shortcuts customization
- Global hotkey to bring app to front

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
