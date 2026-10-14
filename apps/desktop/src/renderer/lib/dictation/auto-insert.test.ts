import { describe, expect, it } from "vitest";
import { autoInsertState, countdownMs, resumedVad } from "./auto-insert";
import { updateVad, VAD_START, type VadState } from "./vad";

const ctx = { enabled: true, delaySec: 7, paused: false, dismissed: false };
const feed = (s: VadState, level: number, chunks: number) => {
  let out = s;
  for (let i = 0; i < chunks; i++) out = updateVad(out, level, 100);
  return out;
};
const SPEECH = 0.1;
const QUIET = 0.001;
const spoke = () => feed(VAD_START, SPEECH, 5);

describe("auto insert after silence", () => {
  it("never before speech was heard, however long the silence", () => {
    expect(autoInsertState(feed(VAD_START, QUIET, 200), ctx).kind).toBe("off");
  });

  it("silence accumulates after speech: waiting, then the 3 s countdown, then fire", () => {
    let s = feed(spoke(), QUIET, 39);
    expect(autoInsertState(s, ctx).kind).toBe("waiting");
    s = feed(s, QUIET, 1);
    expect(autoInsertState(s, ctx)).toEqual({ kind: "countdown", remainingMs: 3000 });
    s = feed(s, QUIET, 21);
    expect(countdownMs(autoInsertState(s, ctx))).toBe(900);
    s = feed(s, QUIET, 9);
    expect(autoInsertState(s, ctx).kind).toBe("fire");
  });

  it("speech resets the countdown", () => {
    let s = feed(spoke(), QUIET, 60);
    expect(autoInsertState(s, ctx).kind).toBe("countdown");
    s = feed(s, SPEECH, 1);
    expect(autoInsertState(s, ctx).kind).toBe("waiting");
    expect(countdownMs(autoInsertState(s, ctx))).toBeNull();
  });

  it("follows the delay picked", () => {
    const s = feed(spoke(), QUIET, 50);
    expect(autoInsertState(s, { ...ctx, delaySec: 5 }).kind).toBe("fire");
    expect(autoInsertState(s, { ...ctx, delaySec: 10 }).kind).toBe("waiting");
  });

  it("off when the setting is off, while paused, or once the countdown was clicked", () => {
    const s = feed(spoke(), QUIET, 100);
    expect(autoInsertState(s, { ...ctx, enabled: false }).kind).toBe("off");
    expect(autoInsertState(s, { ...ctx, paused: true }).kind).toBe("off");
    expect(autoInsertState(s, { ...ctx, dismissed: true }).kind).toBe("off");
  });

  it("silence before a pause does not count after the resume", () => {
    const s = resumedVad(feed(spoke(), QUIET, 65));
    expect(autoInsertState(s, ctx).kind).toBe("waiting");
    expect(s.heard).toBe(true);
  });
});
