import { describe, expect, it } from "vitest";
import type { QaAction, QaRecording } from "./qa-recorder";
import { exportToPlaywright, formatRecordingForAgent } from "./qa-recorder";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRecording(overrides: Partial<QaRecording> = {}): QaRecording {
  return {
    startUrl: "http://localhost:3000",
    startedAt: Date.now(),
    actions: [],
    consoleErrors: [],
    ...overrides,
  };
}

function makeAction(overrides: Partial<QaAction>): QaAction {
  return {
    type: "click",
    timestamp: Date.now(),
    selector: "body",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// exportToPlaywright
// ---------------------------------------------------------------------------

describe("exportToPlaywright", () => {
  it("empty recording produces basic test skeleton with goto", () => {
    const recording = makeRecording();
    const result = exportToPlaywright(recording);

    expect(result).toContain("import { test, expect } from '@playwright/test';");
    expect(result).toContain("test('recorded flow', async ({ page }) => {");
    expect(result).toContain("await page.goto('http://localhost:3000');");
    expect(result).toContain("});");
  });

  it("click action generates page.click(selector)", () => {
    const recording = makeRecording({
      actions: [
        makeAction({
          type: "click",
          selector: "#submit-btn",
          coordinates: { x: 100, y: 200 },
        }),
      ],
    });
    const result = exportToPlaywright(recording);

    expect(result).toContain("await page.click('#submit-btn');");
  });

  it("input action generates page.fill(selector, value)", () => {
    const recording = makeRecording({
      actions: [
        makeAction({
          type: "input",
          selector: "#email",
          value: "test@example.com",
        }),
      ],
    });
    const result = exportToPlaywright(recording);

    expect(result).toContain("await page.fill('#email', 'test@example.com');");
  });

  it("navigate action generates page.goto(url)", () => {
    const recording = makeRecording({
      actions: [
        makeAction({
          type: "navigate",
          selector: "",
          url: "http://localhost:3000/about",
        }),
      ],
    });
    const result = exportToPlaywright(recording);

    expect(result).toContain("await page.goto('http://localhost:3000/about');");
  });

  it("keypress action generates page.press('body', key)", () => {
    const recording = makeRecording({
      actions: [
        makeAction({
          type: "keypress",
          selector: "body",
          value: "Enter",
        }),
      ],
    });
    const result = exportToPlaywright(recording);

    expect(result).toContain("await page.press('body', 'Enter');");
  });

  it("multiple actions produce correct sequence", () => {
    const recording = makeRecording({
      actions: [
        makeAction({ type: "navigate", selector: "", url: "http://localhost:3000/login" }),
        makeAction({ type: "input", selector: "#email", value: "user@test.com" }),
        makeAction({ type: "input", selector: "#password", value: "secret123" }),
        makeAction({ type: "click", selector: "#login-btn" }),
        makeAction({ type: "keypress", selector: "body", value: "Escape" }),
      ],
    });
    const result = exportToPlaywright(recording);
    const lines = result.split("\n");

    // Find line indices for each action (after the initial goto)
    const gotoLogin = lines.findIndex((l) => l.includes("goto('http://localhost:3000/login')"));
    const fillEmail = lines.findIndex((l) => l.includes("fill('#email'"));
    const fillPass = lines.findIndex((l) => l.includes("fill('#password'"));
    const clickBtn = lines.findIndex((l) => l.includes("click('#login-btn')"));
    const pressEsc = lines.findIndex((l) => l.includes("press('body', 'Escape')"));

    expect(gotoLogin).toBeGreaterThan(-1);
    expect(fillEmail).toBeGreaterThan(gotoLogin);
    expect(fillPass).toBeGreaterThan(fillEmail);
    expect(clickBtn).toBeGreaterThan(fillPass);
    expect(pressEsc).toBeGreaterThan(clickBtn);
  });
});

// ---------------------------------------------------------------------------
// formatRecordingForAgent
// ---------------------------------------------------------------------------

describe("formatRecordingForAgent", () => {
  it("empty recording produces header only", () => {
    const recording = makeRecording();
    const result = formatRecordingForAgent(recording);

    expect(result).toContain("[QA Recording] 0 actions recorded at http://localhost:3000");
    expect(result).toContain(
      "Generate a Playwright test that reproduces this flow and add assertions for expected behavior.",
    );
    // No numbered action lines
    expect(result).not.toMatch(/^\d+\./m);
  });

  it("recording with actions produces numbered action list", () => {
    const recording = makeRecording({
      actions: [
        makeAction({ type: "click", selector: ".hero > button", coordinates: { x: 120, y: 340 } }),
        makeAction({ type: "input", selector: "#email", value: "test@example.com" }),
        makeAction({ type: "navigate", selector: "", url: "http://localhost:3000/dashboard" }),
      ],
    });
    const result = formatRecordingForAgent(recording);

    expect(result).toContain("[QA Recording] 3 actions recorded at http://localhost:3000");
    expect(result).toContain("1. CLICK .hero > button (120, 340)");
    expect(result).toContain('2. INPUT #email \u2192 "test@example.com"');
    expect(result).toContain("3. NAVIGATE \u2192 http://localhost:3000/dashboard");
  });

  it("recording with console errors includes errors section", () => {
    const recording = makeRecording({
      actions: [makeAction({ type: "click", selector: "#btn" })],
      consoleErrors: [
        "TypeError: Cannot read property 'foo' of undefined",
        "ReferenceError: bar is not defined",
      ],
    });
    const result = formatRecordingForAgent(recording);

    expect(result).toContain("Console errors during flow:");
    expect(result).toContain("- TypeError: Cannot read property 'foo' of undefined");
    expect(result).toContain("- ReferenceError: bar is not defined");
  });

  it("action types are formatted correctly (CLICK, INPUT, NAVIGATE, KEYPRESS)", () => {
    const recording = makeRecording({
      actions: [
        makeAction({ type: "click", selector: "#a", coordinates: { x: 10, y: 20 } }),
        makeAction({ type: "input", selector: "#b", value: "hello" }),
        makeAction({ type: "navigate", selector: "", url: "http://example.com" }),
        makeAction({ type: "keypress", selector: "#c", value: "Tab" }),
      ],
    });
    const result = formatRecordingForAgent(recording);

    expect(result).toContain("1. CLICK #a");
    expect(result).toContain("2. INPUT #b");
    expect(result).toContain("3. NAVIGATE");
    expect(result).toContain("4. KEYPRESS #c \u2192 [Tab]");
  });
});
