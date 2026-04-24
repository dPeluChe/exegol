import { describe, expect, it } from "vitest";
import type { CapturedElement } from "./design-capture";
import { formatElementForAgent } from "./design-capture";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeElement(overrides: Partial<CapturedElement> = {}): CapturedElement {
  return {
    selector: "#hero-btn",
    tagName: "button",
    textContent: "",
    htmlSnippet: '<button id="hero-btn">Click me</button>',
    rect: { x: 100, y: 200, width: 120, height: 40 },
    styles: {
      color: "rgb(255, 255, 255)",
      backgroundColor: "rgb(59, 130, 246)",
      fontSize: "14px",
      fontFamily: '"Inter", sans-serif',
      padding: "8px 16px",
      margin: "0px",
      borderRadius: "6px",
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// formatElementForAgent
// ---------------------------------------------------------------------------

describe("formatElementForAgent", () => {
  it("basic element includes tag, selector, position, size, and styles", () => {
    const el = makeElement();
    const result = formatElementForAgent(el);

    // Tag + position + size
    expect(result).toContain("[Design Capture] Element: <button> at (100, 200) 120x40px");
    // Selector
    expect(result).toContain("Selector: #hero-btn");
    // Styles
    expect(result).toContain("color=rgb(255, 255, 255)");
    expect(result).toContain("bg=rgb(59, 130, 246)");
    expect(result).toContain("font=14px Inter");
    expect(result).toContain("padding=8px 16px");
    expect(result).toContain("radius=6px");
  });

  it("element with text includes the text line", () => {
    const el = makeElement({ textContent: "Sign up now" });
    const result = formatElementForAgent(el);

    expect(result).toContain('Text: "Sign up now"');
  });

  it("element with HTML includes HTML snippet", () => {
    const html = '<div class="card"><span>Hello</span></div>';
    const el = makeElement({ htmlSnippet: html });
    const result = formatElementForAgent(el);

    expect(result).toContain(`HTML: ${html}`);
  });

  it("element without text omits the text line", () => {
    const el = makeElement({ textContent: "" });
    const result = formatElementForAgent(el);

    expect(result).not.toContain("Text:");
  });

  it("styles formatted correctly (color=, bg=, font=, padding=, radius=)", () => {
    const el = makeElement({
      styles: {
        color: "rgb(0, 0, 0)",
        backgroundColor: "rgba(0, 0, 0, 0)",
        fontSize: "16px",
        fontFamily: "'Fira Code', monospace",
        padding: "12px",
        margin: "4px",
        borderRadius: "0px",
      },
    });
    const result = formatElementForAgent(el);

    expect(result).toContain("color=rgb(0, 0, 0)");
    expect(result).toContain("bg=rgba(0, 0, 0, 0)");
    expect(result).toContain("font=16px Fira Code");
    expect(result).toContain("padding=12px");
    expect(result).toContain("radius=0px");
  });

  it("position and size are rounded to integers", () => {
    const el = makeElement({
      rect: { x: 100.7, y: 200.3, width: 119.5, height: 39.8 },
    });
    const result = formatElementForAgent(el);

    expect(result).toContain("at (101, 200) 120x40px");
  });
});
