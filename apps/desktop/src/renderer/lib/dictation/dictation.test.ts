import { DEFAULT_DICTATION_SETTINGS, DEFAULT_DICTATION_SHORTCUT } from "@exegol/shared";
import { describe, expect, it } from "vitest";
import { isClaudeQuestion } from "../claude-question";
import { shortcutClash, shortcutsWith } from "../shortcuts";
import { StreamResampler } from "./resampler";
import {
  answersPrompt,
  cancelsOnFocusChange,
  confirmTarget,
  type FocusSnapshot,
  resolveTarget,
  sanitizeDictation,
  takesDictation,
} from "./target";
import { rms, shouldAutoStop, updateVad, VAD_START } from "./vad";

const sine = (rate: number, seconds: number, hz = 440, amp = 0.5) =>
  Float32Array.from({ length: Math.round(rate * seconds) }, (_, i) =>
    Math.fround(amp * Math.sin((2 * Math.PI * hz * i) / rate)),
  );

function chunked(r: StreamResampler, input: Float32Array, size: number): Float32Array {
  const parts: number[] = [];
  for (let i = 0; i < input.length; i += size) parts.push(...r.push(input.subarray(i, i + size)));
  return Float32Array.from(parts);
}

describe("StreamResampler", () => {
  it.each([48_000, 44_100, 8_000])("turns %i Hz into 16 kHz of the same length", (rate) => {
    const out = new StreamResampler(rate, 16_000).push(sine(rate, 1));
    expect(Math.abs(out.length - 16_000)).toBeLessThanOrEqual(2);
  });

  it("keeps a speech-band tone's level", () => {
    const out = new StreamResampler(48_000, 16_000).push(sine(48_000, 1, 300));
    expect(rms(out)).toBeGreaterThan(0.33);
    expect(rms(out)).toBeLessThan(0.36);
  });

  it("gives the same samples chunked as in one block", () => {
    for (const rate of [48_000, 44_100, 8_000]) {
      const input = sine(rate, 0.5);
      const whole = new StreamResampler(rate, 16_000).push(input);
      const parts = chunked(new StreamResampler(rate, 16_000), input, 128);
      expect(parts.length).toBe(whole.length);
      expect(Array.from(parts)).toEqual(Array.from(whole));
    }
  });

  it("passes 16 kHz through", () => {
    const input = sine(16_000, 0.1);
    expect(Array.from(new StreamResampler(16_000, 16_000).push(input))).toEqual(Array.from(input));
  });
});

describe("energy VAD", () => {
  it("ignores room noise and a click, hears speech", () => {
    let s = updateVad(VAD_START, 0.002, 100);
    expect(s.heard).toBe(false);
    s = updateVad(s, 0.05, 100);
    expect(s.heard).toBe(false);
    s = updateVad(s, 0.05, 100);
    expect(s.heard).toBe(true);
  });

  it("auto-stops only after speech and the set pause; 0 never", () => {
    let s = VAD_START;
    for (let i = 0; i < 50; i++) s = updateVad(s, 0.001, 100);
    expect(shouldAutoStop(s, 2)).toBe(false);
    s = updateVad(updateVad(s, 0.1, 100), 0.1, 100);
    for (let i = 0; i < 19; i++) s = updateVad(s, 0.001, 100);
    expect(shouldAutoStop(s, 2)).toBe(false);
    s = updateVad(s, 0.001, 100);
    expect(shouldAutoStop(s, 2)).toBe(true);
    expect(shouldAutoStop(s, 0)).toBe(false);
  });
});

describe("dictation target", () => {
  const base: FocusSnapshot = {
    activeView: "workspace",
    projectId: "p1",
    focusedPaneId: "pane1",
    pane: { id: "pane1", type: "terminal", agentId: "a1" },
    sessionLive: true,
    editableField: false,
  };

  it("routes by the focused pane's type", () => {
    expect(resolveTarget(base)).toEqual({
      kind: "terminal",
      paneId: "pane1",
      projectId: "p1",
      agentId: "a1",
    });
    expect(resolveTarget({ ...base, pane: { id: "pane1", type: "browser" } }).kind).toBe("browser");
    expect(resolveTarget({ ...base, pane: { id: "pane1", type: "files" } }).kind).toBe("editor");
    expect(resolveTarget({ ...base, pane: { id: "pane1", type: "git" } }).kind).toBe("clipboard");
    expect(resolveTarget({ ...base, editableField: true }).kind).toBe("field");
  });

  it("falls back to the clipboard with no live, focused pane in the workspace", () => {
    expect(resolveTarget({ ...base, sessionLive: false }).kind).toBe("clipboard");
    expect(resolveTarget({ ...base, activeView: "dashboard" }).kind).toBe("clipboard");
    expect(resolveTarget({ ...base, focusedPaneId: null }).kind).toBe("clipboard");
    expect(resolveTarget({ ...base, projectId: null }).kind).toBe("clipboard");
  });

  it("never inserts into a pane that lost the focus or another project's pane", () => {
    const start = resolveTarget(base);
    expect(confirmTarget(start, resolveTarget(base))).toBe(start);
    const otherPane = resolveTarget({
      ...base,
      focusedPaneId: "pane2",
      pane: { id: "pane2", type: "terminal", agentId: "a2" },
    });
    expect(confirmTarget(start, otherPane)).toMatchObject({
      kind: "clipboard",
      why: expect.stringMatching(/focus moved/),
    });
    const otherProject = resolveTarget({ ...base, projectId: "p2" });
    expect(confirmTarget(start, otherProject).kind).toBe("clipboard");
  });

  it("targets a focused Dashboard mirror's pane, else copies with a reason", () => {
    const mirror = { agentId: "a9", projectId: "p9", paneId: "pane9", live: true };
    const dash = { ...base, activeView: "dashboard", mirror };
    expect(resolveTarget(dash)).toEqual({
      kind: "terminal",
      paneId: "pane9",
      projectId: "p9",
      agentId: "a9",
    });
    const noPane = resolveTarget({ ...dash, mirror: { ...mirror, paneId: null } });
    expect(noPane.kind).toBe("clipboard");
    expect(noPane.kind === "clipboard" && noPane.why).toBeTruthy();
  });

  it("takes live shells and agents that can be pasted into", () => {
    expect(takesDictation({ cliType: "shell", status: "idle" })).toBe(true);
    expect(takesDictation({ cliType: "shell", status: "running" })).toBe(true);
    expect(takesDictation({ cliType: "shell", status: "stopped" })).toBe(false);
    expect(takesDictation({ cliType: "claude-code", status: "waiting_input" })).toBe(true);
    expect(takesDictation({ cliType: "claude-code", status: "crashed" })).toBe(false);
  });

  it("cancels only when Exegol loses the focus while listening", () => {
    expect(cancelsOnFocusChange(false, "listening")).toBe(true);
    expect(cancelsOnFocusChange(false, "starting")).toBe(false);
    expect(cancelsOnFocusChange(false, "transcribing")).toBe(false);
    expect(cancelsOnFocusChange(true, "listening")).toBe(false);
  });

  it("never answers an agent's question", () => {
    const at = { status: "waiting_input" as const, dialogOnScreen: false, awaitingAnswer: false };
    expect(answersPrompt(at)).toBe(false);
    expect(answersPrompt({ ...at, dialogOnScreen: true })).toBe(true);
    expect(answersPrompt({ ...at, awaitingAnswer: true })).toBe(true);
    expect(answersPrompt({ ...at, status: "running", awaitingAnswer: true })).toBe(false);
  });

  it("strips escape sequences and control characters", () => {
    expect(sanitizeDictation(" hello\x1b[201~; rm -rf ~\r\n")).toBe("hello[201~; rm -rf ~");
    expect(sanitizeDictation("two\nlines\t")).toBe("two\nlines");
  });
});

describe("dictation shortcut", () => {
  it("does not take over an app shortcut by default", () => {
    expect(shortcutClash(DEFAULT_DICTATION_SHORTCUT)).toBeNull();
  });

  it("names the app shortcut a recorded chord would take over", () => {
    expect(shortcutClash("Cmd+Shift+D")).toBe("Split Vertical");
    expect(shortcutClash("Shift+Cmd+D")).toBe("Split Vertical");
    expect(shortcutClash("Cmd+5")).toBe("Project N");
    expect(shortcutClash("Cmd+Option+3")).toBe("Workspace Tab N");
    expect(shortcutClash("Cmd+Shift+M")).toBeNull();
  });

  it("lists the chord the user set, and none with dictation off", () => {
    const keys = (d: object) => shortcutsWith(d).find((s) => s.id === "dictation")?.keys;
    expect(keys({ ...DEFAULT_DICTATION_SETTINGS, shortcut: "Cmd+Shift+M" })).toMatch(/Shift\+M$/);
    expect(keys({ ...DEFAULT_DICTATION_SETTINGS, enabled: false })).toBeUndefined();
  });
});

describe("isClaudeQuestion", () => {
  const since = 1_000_000;
  const agent = { cliType: "claude-code", status: "waiting_input" as const, activitySince: since };
  const item = (after: number) => ({ level: "action_needed", timestamp: since + after });

  it("counts an item raised as Claude started waiting", () => {
    expect(isClaudeQuestion(item(300), agent)).toBe(true);
  });

  // The failing case: idle 60s, the reminder raised an item, dictation went to the clipboard
  it("ignores the idle reminder raised later on the same wait", () => {
    expect(isClaudeQuestion(item(60_000), agent)).toBe(false);
    expect(isClaudeQuestion(item(-120_000), agent)).toBe(false);
  });

  it("only for a waiting Claude session and its own question", () => {
    expect(isClaudeQuestion(item(0), { ...agent, status: "running" })).toBe(false);
    expect(isClaudeQuestion(item(0), { ...agent, cliType: "codex" })).toBe(false);
    expect(isClaudeQuestion({ ...item(0), paneId: "p" }, agent)).toBe(false);
    expect(isClaudeQuestion({ ...item(0), level: "info" }, agent)).toBe(false);
    expect(isClaudeQuestion(undefined, agent)).toBe(false);
  });
});
