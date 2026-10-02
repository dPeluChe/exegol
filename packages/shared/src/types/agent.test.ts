import { describe, expect, it } from "vitest";
import { classifyActivity, deriveIsolationMode, isNewerVersion, MODEL_ID_PATTERN } from "./agent";

// ─── classifyActivity ─────────────────────────────────────────────────────

describe("classifyActivity", () => {
  it("a shell is busy only while a command runs in its foreground", () => {
    expect(classifyActivity("running", "convex dev", "shell")).toBe("busy");
    expect(classifyActivity("running", null, "shell")).toBe("idle");
  });

  // ─── Busy states ──────────────────────────────────────────────────────

  describe("busy states", () => {
    it("running with currentStep returns busy", () => {
      expect(classifyActivity("running", "Thinking...")).toBe("busy");
    });

    it("running without currentStep returns busy (just started)", () => {
      expect(classifyActivity("running")).toBe("busy");
    });

    it("running with null currentStep returns busy", () => {
      expect(classifyActivity("running", null)).toBe("busy");
    });

    it("running with undefined currentStep returns busy", () => {
      expect(classifyActivity("running", undefined)).toBe("busy");
    });

    it("running with empty string currentStep returns busy", () => {
      expect(classifyActivity("running", "")).toBe("busy");
    });

    it("spawning returns busy", () => {
      expect(classifyActivity("spawning")).toBe("busy");
    });

    it("spawning with currentStep returns busy", () => {
      expect(classifyActivity("spawning", "Initializing...")).toBe("busy");
    });

    it("spawning with null currentStep returns busy", () => {
      expect(classifyActivity("spawning", null)).toBe("busy");
    });
  });

  // ─── Idle states ──────────────────────────────────────────────────────

  describe("idle states", () => {
    it("waiting_input returns idle", () => {
      expect(classifyActivity("waiting_input")).toBe("idle");
    });

    it("waiting_input with currentStep still returns idle", () => {
      expect(classifyActivity("waiting_input", "some step")).toBe("idle");
    });

    it("paused returns idle", () => {
      expect(classifyActivity("paused")).toBe("idle");
    });

    it("paused with currentStep still returns idle", () => {
      expect(classifyActivity("paused", "paused step")).toBe("idle");
    });
  });

  // ─── Neutral (terminal) states ────────────────────────────────────────

  describe("neutral (terminal) states", () => {
    it("completed returns neutral", () => {
      expect(classifyActivity("completed")).toBe("neutral");
    });

    it("failed returns neutral", () => {
      expect(classifyActivity("failed")).toBe("neutral");
    });

    it("stopped returns neutral", () => {
      expect(classifyActivity("stopped")).toBe("neutral");
    });

    it("crashed returns neutral", () => {
      expect(classifyActivity("crashed")).toBe("neutral");
    });

    it("idle returns neutral", () => {
      expect(classifyActivity("idle")).toBe("neutral");
    });
  });
});

// ─── deriveIsolationMode ─────────────────────────────────────────────────

describe("deriveIsolationMode", () => {
  it("prefers stored isolationMode when present", () => {
    expect(deriveIsolationMode({ isolationMode: "pipeline", worktreeId: null })).toBe("pipeline");
    expect(deriveIsolationMode({ isolationMode: "fallback", worktreeId: "wt-1" })).toBe("fallback");
  });

  it("returns isolated when worktreeId is set and no stored mode", () => {
    expect(deriveIsolationMode({ worktreeId: "wt-1" })).toBe("isolated");
    expect(deriveIsolationMode({ isolationMode: null, worktreeId: "wt-1" })).toBe("isolated");
  });

  it("returns project-root when neither isolationMode nor worktreeId is set", () => {
    expect(deriveIsolationMode({})).toBe("project-root");
    expect(deriveIsolationMode({ isolationMode: null, worktreeId: null })).toBe("project-root");
  });

  it("returns the stored isolated mode unchanged", () => {
    expect(deriveIsolationMode({ isolationMode: "isolated", worktreeId: "wt-1" })).toBe("isolated");
  });

  it("returns the stored project-root mode unchanged even with a worktreeId", () => {
    // Edge case: explicit project-root flag should override the heuristic.
    expect(deriveIsolationMode({ isolationMode: "project-root", worktreeId: "wt-1" })).toBe(
      "project-root",
    );
  });
});

describe("MODEL_ID_PATTERN", () => {
  it("takes model ids, never shell syntax (it goes into the command unquoted)", () => {
    for (const ok of ["sonnet", "claude-sonnet-4-5", "openai/gpt-5.1", "anthropic:opus@2"]) {
      expect(MODEL_ID_PATTERN.test(ok)).toBe(true);
    }
    for (const bad of ["opus; rm -rf ~", "$(id)", "a b", "opus[1m]", "`x`", ""]) {
      expect(MODEL_ID_PATTERN.test(bad)).toBe(false);
    }
  });
});

describe("isNewerVersion", () => {
  it("compares the numbers CLIs print", () => {
    expect(isNewerVersion("2.1.290", "2.1.286")).toBe(true);
    expect(isNewerVersion("2.1.286", "2.1.286")).toBe(false);
    expect(isNewerVersion("0.159.2", "0.155.10")).toBe(true);
    expect(isNewerVersion("0.0.1769000000-gabc", "0.0.1768000000-gdef")).toBe(true);
    expect(isNewerVersion("3000.11.3 (a1b2)", "3000.12.0")).toBe(false);
    expect(isNewerVersion(null, "1.0.0")).toBe(false);
  });
});
