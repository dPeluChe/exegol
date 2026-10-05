import Database from "libsql";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pty = vi.hoisted(() => ({
  alive: true,
  delayMs: 0,
  inFlight: 0,
  maxInFlight: 0,
  order: [] as string[],
}));

vi.mock("../lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));
vi.mock("../db/queries", () => ({ updateAgentStatus: vi.fn() }));
vi.mock("../ipc/procedures/scrollback", () => ({ getScrollbackPath: () => "/tmp/sb" }));
vi.mock("../mcp/exegol-mcp-config", () => ({
  readAgentMcpToken: () => null,
  readPerAgentMcpToken: () => null,
}));
vi.mock("../mcp/exegol-server", () => ({
  ensureExegolMcpServerStarted: vi.fn(),
  restoreAgentMcpToken: vi.fn(),
}));
vi.mock("../terminal/pty-host", () => ({
  getPtyHost: () => ({
    reattachSession: async (id: string) => {
      pty.order.push(id);
      pty.maxInFlight = Math.max(pty.maxInFlight, ++pty.inFlight);
      await new Promise((r) => setTimeout(r, pty.delayMs));
      pty.inFlight--;
      return "";
    },
    isAlive: () => pty.alive,
  }),
}));
vi.mock("../lib/event-bus", () => ({ broadcast: vi.fn() }));
vi.mock("./agent-output-processor", () => ({ createOutputProcessor: () => ({}) }));
vi.mock("./agent-session-callbacks", () => ({
  appendScrollback: vi.fn(),
  createSpawnCallbacks: () => ({}),
}));
vi.mock("./agent-worktree-ops", () => ({
  cleanupWorktree: vi.fn(),
  hydrateTrackedWorktree: vi.fn(),
}));
vi.mock("./registry", () => ({ getProviderRegistry: () => ({ get: () => undefined }) }));
vi.mock("./spawn-env", () => ({
  broadcastAgentStatus: vi.fn(),
  DEFAULT_PTY_COLS: 80,
  DEFAULT_PTY_ROWS: 24,
}));

import { getRecoveryState, whenSessionReady } from "../terminal/reattach-gate";
import type { SessionMaps } from "./agent-session-callbacks";
import { reattachSidecarAgents } from "./reattach-sidecar-agents";
import { broadcastAgentStatus } from "./spawn-env";

function setupDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE agents (
    id TEXT PRIMARY KEY, cli_type TEXT, project_id TEXT, task_description TEXT, status TEXT,
    current_step TEXT, launched_in_shell INTEGER, pty_cols INTEGER, pty_rows INTEGER,
    resume_command TEXT
  )`);
  db.exec("CREATE TABLE projects (id TEXT PRIMARY KEY, path TEXT)");
  return db;
}

function emptyMaps(): SessionMaps {
  return {
    outputProcessors: new Map(),
    titleTrackers: new Map(),
    scrollbackBuffers: new Map(),
    scrollbackSizes: new Map(),
    completionCallbacks: new Map(),
    initialSnapshots: new Map(),
    dataCallbacks: new Map(),
    sessionIdsCaptured: new Set(),
    stopRequested: new Set(),
    contexts: new Map(),
  };
}

async function reattach(cliType: string) {
  const db = setupDb();
  db.prepare(
    "INSERT INTO agents (id, cli_type, project_id, task_description, status) VALUES (?, ?, ?, ?, ?)",
  ).run("a1", cliType, "p1", "task", "running");
  const maps = emptyMaps();
  const result = await reattachSidecarAgents(db, ["a1"], maps, new Map(), 1024);
  return { maps, result };
}

describe("reattachSidecarAgents output pipeline", () => {
  beforeEach(() => {
    pty.alive = true;
    pty.delayMs = 0;
    pty.maxInFlight = 0;
    pty.order = [];
    vi.mocked(broadcastAgentStatus).mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it("rebuilds the title tracker a spawn would set up", async () => {
    const { maps, result } = await reattach("claude-code");
    expect(result.aliveIds.has("a1")).toBe(true);
    expect(maps.outputProcessors.has("a1")).toBe(true);
    expect(maps.scrollbackSizes.get("a1")).toBe(0);

    vi.useFakeTimers();
    vi.mocked(broadcastAgentStatus).mockClear();
    maps.titleTrackers.get("a1")?.("\x1b]0;✦ Working\x07");
    vi.advanceTimersByTime(500);
    expect(broadcastAgentStatus).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: "a1", projectId: "p1", status: "running" }),
    );
  });

  it("skips the title tracker for CLIs that do not report status in the title", async () => {
    const { maps } = await reattach("aider");
    expect(maps.outputProcessors.has("a1")).toBe(true);
    expect(maps.titleTrackers.has("a1")).toBe(false);
  });

  it("attaches nothing for a plain shell", async () => {
    const { maps } = await reattach("shell");
    expect(maps.outputProcessors.size).toBe(0);
    expect(maps.titleTrackers.size).toBe(0);
  });

  it("drops the whole pipeline when the PTY is dead", async () => {
    pty.alive = false;
    const { maps, result } = await reattach("claude-code");
    expect(result.deadIds.has("a1")).toBe(true);
    expect(maps.outputProcessors.size).toBe(0);
    expect(maps.titleTrackers.size).toBe(0);
    expect(maps.scrollbackBuffers.size).toBe(0);
  });
});

describe("reattachSidecarAgents pool", () => {
  it("reattaches 3 at a time, a session a pane waits on next", async () => {
    pty.alive = true;
    pty.delayMs = 20;
    pty.maxInFlight = 0;
    pty.order = [];
    const db = setupDb();
    const ids = Array.from({ length: 9 }, (_, i) => `s${i}`);
    for (const id of ids) {
      db.prepare(
        "INSERT INTO agents (id, cli_type, project_id, task_description, status) VALUES (?, 'shell', 'p1', '', 'running')",
      ).run(id);
    }
    const started = Date.now();
    const run = reattachSidecarAgents(db, ids, emptyMaps(), new Map(), 1024);
    // A pane mounts while the first three are in flight
    const waited = whenSessionReady("s7");
    const result = await run;
    const elapsed = Date.now() - started;
    await waited;

    expect(result.aliveIds.size).toBe(9);
    expect(pty.order.slice(0, 4)).toEqual(["s0", "s1", "s2", "s7"]);
    expect(pty.maxInFlight).toBe(3);
    // 3 rounds of 20ms, not 9 one after another
    expect(elapsed).toBeLessThan(9 * 20);
    expect(getRecoveryState().ready).toEqual(expect.arrayContaining(ids));
  });
});
