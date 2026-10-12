import { describe, expect, it } from "vitest";
import type { ProcRow } from "../system/shell-clis";
import {
  agentBusy,
  type IdleContext,
  type IdleSession,
  idleVerdict,
  shellAtRest,
  treeRssMb,
  typedCliBusy,
} from "./idle-suspend";

const DAY = 86_400_000;
const NOW = 100 * DAY;

const agent = (over: Partial<IdleSession> = {}): IdleSession => ({
  id: "a1",
  cliType: "claude-code",
  status: "waiting_input",
  launchedInShell: false,
  prWatch: false,
  driven: false,
  startedAt: (NOW - 30 * DAY) / 1000,
  statusChangedAt: NOW - 8 * DAY,
  lastActivityAt: null,
  ...over,
});

const ctx = (over: Partial<IdleContext> = {}): IdleContext => ({
  now: NOW,
  days: 7,
  exempt: new Set(),
  awaitingApproval: () => false,
  questionOnScreen: () => false,
  activity: () => undefined,
  since: NOW - 20 * DAY,
  ...over,
});

describe("idleVerdict", () => {
  it("suspends an agent idle past the threshold, not one under it", () => {
    expect(idleVerdict(agent(), ctx())).toMatchObject({ kind: "agent" });
    expect(idleVerdict(agent({ statusChangedAt: NOW - 6 * DAY }), ctx())).toBeNull();
  });

  it("Off never decides anything", () => {
    expect(idleVerdict(agent(), ctx({ days: 0 }))).toBeNull();
  });

  it("recent activity, this run or persisted before a restart, resets the clock", () => {
    expect(idleVerdict(agent(), ctx({ activity: () => NOW - DAY }))).toBeNull();
    expect(idleVerdict(agent({ lastActivityAt: NOW - DAY }), ctx())).toBeNull();
  });

  it("skips working, watched, PR-watched, driven and waiting sessions", () => {
    expect(idleVerdict(agent({ status: "running" }), ctx())).toMatchObject({ reason: "running" });
    expect(idleVerdict(agent({ status: "spawning" }), ctx())).toMatchObject({ kind: "skip" });
    expect(idleVerdict(agent(), ctx({ exempt: new Set(["a1"]) }))).toMatchObject({
      kind: "skip",
    });
    expect(idleVerdict(agent({ prWatch: true }), ctx())).toMatchObject({ reason: "pr watch" });
    expect(idleVerdict(agent({ driven: true }), ctx())).toMatchObject({ kind: "skip" });
    expect(idleVerdict(agent(), ctx({ awaitingApproval: () => true }))).toMatchObject({
      reason: "needs attention",
    });
    expect(idleVerdict(agent(), ctx({ questionOnScreen: () => true }))).toMatchObject({
      reason: "needs attention",
    });
  });

  it("a shell's clock is its persisted activity or main's start, never its stale status time", () => {
    const shell = agent({ cliType: "shell", status: "running", statusChangedAt: NOW - 50 * DAY });
    expect(idleVerdict(shell, ctx())).toMatchObject({ kind: "shell" });
    expect(idleVerdict(shell, ctx({ since: NOW - DAY }))).toBeNull();
    expect(
      idleVerdict({ ...shell, lastActivityAt: NOW - 9 * DAY }, ctx({ since: NOW })),
    ).toMatchObject({ kind: "shell" });
  });

  it("a CLI typed in a shell is an agent while it runs, a shell once back at the prompt", () => {
    const typed = agent({ launchedInShell: true });
    expect(idleVerdict(typed, ctx())).toMatchObject({ kind: "agent" });
    expect(idleVerdict({ ...typed, status: "idle" }, ctx())).toMatchObject({ kind: "shell" });
  });
});

const row = (pid: number, ppid: number, args: string, extra: Partial<ProcRow> = {}): ProcRow => ({
  pid,
  ppid,
  pgid: pid,
  tpgid: 10,
  tty: "ttys003",
  rss: 1024,
  args,
  ...extra,
});

describe("shellAtRest", () => {
  const shell = row(10, 1, "-zsh", { pgid: 10 });

  it("a shell at its prompt with only childless forks of itself and gitstatusd", () => {
    const rows = [
      shell,
      row(11, 10, "-zsh", { pgid: 10 }),
      row(12, 10, "/opt/gitstatusd-darwin-arm64 -s 1", { tty: "??" }),
    ];
    expect(shellAtRest(10, rows)).toBe(true);
  });

  it("a fork running something is not the shell's own", () => {
    const rows = [shell, row(11, 10, "-zsh", { pgid: 11 }), row(13, 11, "sleep 999")];
    expect(shellAtRest(10, rows)).toBe(false);
  });

  it("a foreground command keeps it", () => {
    expect(shellAtRest(10, [{ ...shell, tpgid: 20 }, row(20, 10, "tail -f log")])).toBe(false);
  });

  it("(npm run dev &): reparented to launchd, still on the tty", () => {
    expect(shellAtRest(10, [shell, row(30, 1, "npm run dev", { pgid: 30 })])).toBe(false);
  });

  it("nohup srv & disown: a background child", () => {
    expect(shellAtRest(10, [shell, row(31, 10, "srv", { pgid: 31 })])).toBe(false);
  });

  it("zsh ./job.sh &: a zsh that is not the shell's own command line", () => {
    expect(shellAtRest(10, [shell, row(32, 10, "zsh ./job.sh", { pgid: 32 })])).toBe(false);
  });

  it("a shell missing from the table is never closed", () => {
    expect(shellAtRest(10, [])).toBe(false);
  });
});

describe("agentBusy", () => {
  const cli = row(40, 1, "claude", { tty: "ttys005", tpgid: 40 });
  const mcp = row(41, 40, "node exegol-mcp-shim", { tty: "ttys005", tpgid: 40 });

  it("the CLI and its own children (MCP servers) are fine", () => {
    expect(agentBusy(40, [cli, mcp], new Set())).toBe(false);
  });

  it("something on its tty outside the CLI subtree keeps it", () => {
    const stray = row(42, 1, "node vite", { tty: "ttys005" });
    expect(agentBusy(40, [cli, mcp, stray], new Set())).toBe(true);
  });

  it("a process in it listening on a port keeps it", () => {
    expect(agentBusy(40, [cli, mcp], new Set([41]))).toBe(true);
  });

  it("a CLI missing from the table keeps it", () => {
    expect(agentBusy(40, [], new Set())).toBe(true);
  });
});

describe("typedCliBusy", () => {
  const shell = row(10, 1, "-zsh", { pgid: 10, tpgid: 50 });
  const cli = row(50, 10, "codex", { pgid: 50, tpgid: 50 });
  const child = row(51, 50, "node mcp", { pgid: 50, tpgid: 50 });

  it("the shell with only the CLI's group is idle", () => {
    expect(typedCliBusy(10, [shell, cli, child], new Set())).toBe(false);
  });

  it("a background job beside the CLI keeps it", () => {
    const job = row(60, 10, "npm run dev", { pgid: 60, tpgid: 50 });
    expect(typedCliBusy(10, [shell, cli, child, job], new Set())).toBe(true);
  });

  it("a listener in the CLI keeps it; no CLI in the foreground keeps it too", () => {
    expect(typedCliBusy(10, [shell, cli, child], new Set([51]))).toBe(true);
    expect(typedCliBusy(10, [{ ...shell, tpgid: 10 }, cli], new Set())).toBe(true);
  });
});

describe("treeRssMb", () => {
  it("adds the session's whole tree", () => {
    const rows = [row(10, 1, "claude"), row(11, 10, "node mcp"), row(30, 1, "other")];
    expect(treeRssMb(10, rows)).toBe(2);
    expect(treeRssMb(null, rows)).toBe(0);
  });
});
