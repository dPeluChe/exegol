import { describe, expect, it, vi } from "vitest";
import {
  createTitleStatusTracker,
  detectStatusFromTitle,
  extractTitleFromData,
  titleStatusToAgentStatus,
} from "./title-status";

describe("extractTitleFromData", () => {
  it("extracts OSC title with BEL terminator", () => {
    expect(extractTitleFromData("\x1b]0;My Title\x07")).toBe("My Title");
  });

  it("extracts OSC title with ST terminator", () => {
    expect(extractTitleFromData("\x1b]0;My Title\x1b\\")).toBe("My Title");
  });

  it("extracts OSC type 2 title", () => {
    expect(extractTitleFromData("\x1b]2;Window Title\x07")).toBe("Window Title");
  });

  it("returns last title when multiple present", () => {
    expect(extractTitleFromData("\x1b]0;First\x07stuff\x1b]0;Second\x07")).toBe("Second");
  });

  it("returns null for no OSC sequences", () => {
    expect(extractTitleFromData("plain text output")).toBeNull();
  });

  it("returns null for empty data", () => {
    expect(extractTitleFromData("")).toBeNull();
  });

  it("handles title embedded in other output", () => {
    expect(extractTitleFromData("before\x1b]0;Title\x07after")).toBe("Title");
  });
});

describe("detectStatusFromTitle", () => {
  it("returns null for empty string", () => {
    expect(detectStatusFromTitle("")).toBeNull();
  });

  // Gemini symbols
  it("detects Gemini permission (✋)", () => {
    expect(detectStatusFromTitle("✋ Gemini")).toBe("permission");
  });

  it("detects Gemini working (✦)", () => {
    expect(detectStatusFromTitle("✦ Processing")).toBe("working");
  });

  it("detects Gemini idle (◇)", () => {
    expect(detectStatusFromTitle("◇ Ready")).toBe("idle");
  });

  // Claude Code patterns
  it("detects Claude idle (✳ prefix)", () => {
    expect(detectStatusFromTitle("✳ claude-code")).toBe("idle");
  });

  it("detects Claude idle (bare ✳)", () => {
    expect(detectStatusFromTitle("✳")).toBe("idle");
  });

  it('detects Claude working (". " prefix)', () => {
    expect(detectStatusFromTitle(". Reading file.ts")).toBe("working");
  });

  it('detects Claude idle ("* " prefix)', () => {
    expect(detectStatusFromTitle("* done")).toBe("idle");
  });

  // Braille spinner
  it("detects braille spinner as working", () => {
    expect(detectStatusFromTitle("⠋ loading")).toBe("working");
    expect(detectStatusFromTitle("⠿ progress")).toBe("working");
  });

  // Keyword matching (requires agent name)
  it("detects working keyword with agent name", () => {
    expect(detectStatusFromTitle("claude - thinking...")).toBe("working");
  });

  it("detects idle keyword with agent name", () => {
    expect(detectStatusFromTitle("gemini ready")).toBe("idle");
  });

  it("detects permission keyword with agent name", () => {
    expect(detectStatusFromTitle("codex - action required")).toBe("permission");
  });

  it("returns null for keywords without agent name", () => {
    expect(detectStatusFromTitle("working on something")).toBeNull();
  });

  it("returns idle for agent name without specific keyword", () => {
    expect(detectStatusFromTitle("claude")).toBe("idle");
  });
});

describe("titleStatusToAgentStatus", () => {
  it("maps working to running", () => {
    expect(titleStatusToAgentStatus("working")).toBe("running");
  });

  it("maps idle to waiting_input", () => {
    expect(titleStatusToAgentStatus("idle")).toBe("waiting_input");
  });

  it("maps permission to waiting_input", () => {
    expect(titleStatusToAgentStatus("permission")).toBe("waiting_input");
  });

  it("maps null to null", () => {
    expect(titleStatusToAgentStatus(null)).toBeNull();
  });
});

describe("createTitleStatusTracker", () => {
  it("calls onStatusChange on status transition after debounce", () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    const tracker = createTitleStatusTracker(callback);

    tracker("\x1b]0;✦ Working\x07");
    expect(callback).not.toHaveBeenCalled();

    vi.advanceTimersByTime(500);
    expect(callback).toHaveBeenCalledWith("running", "✦ Working");

    vi.useRealTimers();
  });

  it("suppresses duplicate status", () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    const tracker = createTitleStatusTracker(callback);

    tracker("\x1b]0;✦ First\x07");
    vi.advanceTimersByTime(500);
    tracker("\x1b]0;✦ Still working\x07");
    vi.advanceTimersByTime(500);

    expect(callback).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("fires on status transition", () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    const tracker = createTitleStatusTracker(callback);

    tracker("\x1b]0;✦ Working\x07");
    vi.advanceTimersByTime(500);
    tracker("\x1b]0;◇ Done\x07");
    vi.advanceTimersByTime(500);

    expect(callback).toHaveBeenCalledTimes(2);
    expect(callback).toHaveBeenNthCalledWith(1, "running", "✦ Working");
    expect(callback).toHaveBeenNthCalledWith(2, "waiting_input", "◇ Done");
    vi.useRealTimers();
  });

  it("ignores data without OSC title", () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    const tracker = createTitleStatusTracker(callback);

    tracker("regular output without title");
    vi.advanceTimersByTime(500);

    expect(callback).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("debounces rapid title changes", () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    const tracker = createTitleStatusTracker(callback);

    // Simulate Gemini rapid title updates — all "working" status
    tracker("\x1b]0;✦ a\x07");
    vi.advanceTimersByTime(100);
    tracker("\x1b]0;◇ b\x07"); // switches to idle
    vi.advanceTimersByTime(100);
    tracker("\x1b]0;✦ c\x07"); // back to working

    // Only the last status fires after debounce
    vi.advanceTimersByTime(500);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith("running", "✦ c");
    vi.useRealTimers();
  });
});
