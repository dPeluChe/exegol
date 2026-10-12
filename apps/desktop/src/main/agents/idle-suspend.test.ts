import { describe, expect, it } from "vitest";
import type { ProcRow } from "../system/shell-clis";
import {
  type IdleContext,
  type IdleSession,
  idleVerdict,
  shellAtRest,
  treeRssMb,
} from "./idle-suspend";

const DAY = 86_400_000;
const NOW = 100 * DAY;

const agent = (over: Partial<IdleSession> = {}): IdleSession => ({
  id: "a1",
  cliType: "claude-code",
  status: "waiting_input",
  launchedInShell: false,
  prWatch: false,
  startedAt: (NOW - 30 * DAY) / 1000,
  statusChangedAt: NOW - 8 * DAY,
  ...over,
});

const ctx = (over: Partial<IdleContext> = {}): IdleContext => ({
  now: NOW,
  days: 7,
  exempt: new Set(),
  awaitingApproval: () => false,
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

  it("recent input or output in main resets the clock", () => {
    expect(idleVerdict(agent(), ctx({ activity: () => NOW - DAY }))).toBeNull();
  });

  it("skips working, watched, PR-watched and waiting sessions", () => {
    expect(idleVerdict(agent({ status: "running" }), ctx())).toMatchObject({ reason: "running" });
    expect(idleVerdict(agent({ status: "spawning" }), ctx())).toMatchObject({ kind: "skip" });
    expect(idleVerdict(agent(), ctx({ exempt: new Set(["a1"]) }))).toMatchObject({
      kind: "skip",
    });
    expect(idleVerdict(agent({ prWatch: true }), ctx())).toMatchObject({ reason: "pr watch" });
    expect(idleVerdict(agent(), ctx({ awaitingApproval: () => true }))).toMatchObject({
      reason: "needs attention",
    });
  });

  it("a shell's clock is main's own record, never its stale status time", () => {
    const shell = agent({ cliType: "shell", status: "running", statusChangedAt: NOW - 50 * DAY });
    expect(idleVerdict(shell, ctx())).toMatchObject({ kind: "shell" });
    expect(idleVerdict(shell, ctx({ since: NOW - DAY }))).toBeNull();
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

  it("a shell at its prompt with only its own forks and prompt helpers", () => {
    const rows = [shell, row(11, 10, "zsh"), row(12, 10, "/opt/gitstatusd-darwin-arm64 -s 1")];
    expect(shellAtRest(10, rows)).toBe(true);
  });

  it("a foreground command keeps it", () => {
    const rows = [{ ...shell, tpgid: 20 }, row(20, 10, "tail -f log")];
    expect(shellAtRest(10, rows)).toBe(false);
  });

  it("a background job keeps it", () => {
    expect(shellAtRest(10, [shell, row(21, 10, "npm run dev")])).toBe(false);
  });

  it("a shell missing from the table is never closed", () => {
    expect(shellAtRest(10, [])).toBe(false);
  });
});

describe("treeRssMb", () => {
  it("adds the session's whole tree", () => {
    const rows = [row(10, 1, "claude"), row(11, 10, "node mcp"), row(30, 1, "other")];
    expect(treeRssMb(10, rows)).toBe(2);
    expect(treeRssMb(null, rows)).toBe(0);
  });
});
