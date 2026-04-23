/**
 * T102: QA Test Mode recording library.
 *
 * Self-contained module for capturing user interactions in a webview,
 * exporting recordings as Playwright test scripts, and formatting
 * recordings as structured agent prompts.
 *
 * No external dependencies — pure TypeScript.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type QaActionType = "click" | "input" | "navigate" | "scroll" | "keypress";

export interface QaAction {
  type: QaActionType;
  timestamp: number;
  selector: string;
  /** For input/keypress actions */
  value?: string;
  /** For click actions */
  coordinates?: { x: number; y: number };
  /** For navigate actions */
  url?: string;
  /** Screenshot at this step (base64 PNG) */
  screenshotBase64?: string;
}

export interface QaRecording {
  startUrl: string;
  startedAt: number;
  actions: QaAction[];
  consoleErrors: string[];
}

// ---------------------------------------------------------------------------
// Selector builder (injected into webview)
// ---------------------------------------------------------------------------

/**
 * Build a minimal CSS selector for an element. Prefers:
 * 1. id
 * 2. data-testid
 * 3. tag + classes + nth-child chain
 */
function buildSelectorSource(): string {
  // This function body is stringified into the injection script.
  // It runs inside the webview context, NOT in the renderer.
  return `
function __exegolBuildSelector(el) {
  if (!el || el === document.body || el === document.documentElement) return "body";

  // Prefer id
  if (el.id) return "#" + CSS.escape(el.id);

  // Prefer data-testid
  var testId = el.getAttribute("data-testid");
  if (testId) return "[data-testid=" + JSON.stringify(testId) + "]";

  // Build chain up to an ancestor with id or data-testid (max 5 levels)
  var parts = [];
  var current = el;
  for (var depth = 0; depth < 5 && current && current !== document.body; depth++) {
    var tag = current.tagName.toLowerCase();
    if (current.id) {
      parts.unshift("#" + CSS.escape(current.id));
      break;
    }
    var tid = current.getAttribute("data-testid");
    if (tid) {
      parts.unshift("[data-testid=" + JSON.stringify(tid) + "]");
      break;
    }
    var seg = tag;
    if (current.className && typeof current.className === "string") {
      var cls = current.className.trim().split(/\\s+/).slice(0, 2).map(function(c) {
        return "." + CSS.escape(c);
      }).join("");
      seg += cls;
    }
    // nth-child for disambiguation
    var parent = current.parentElement;
    if (parent) {
      var siblings = Array.from(parent.children).filter(function(s) {
        return s.tagName === current.tagName;
      });
      if (siblings.length > 1) {
        var idx = siblings.indexOf(current) + 1;
        seg += ":nth-child(" + idx + ")";
      }
    }
    parts.unshift(seg);
    current = parent;
  }
  return parts.join(" > ");
}`;
}

// ---------------------------------------------------------------------------
// Injection script
// ---------------------------------------------------------------------------

/**
 * JavaScript source to inject into a webview's `executeJavaScript`.
 *
 * Captures clicks, text inputs (debounced 500ms), navigations, and
 * console.error output. All data stored on `window.__exegolQaActions`.
 * Call `window.__exegolQaDisable()` to stop recording and clean up.
 */
export const QA_MODE_INJECTION_SCRIPT = `(function() {
  "use strict";
  if (window.__exegolQaActions) return; // already injected

  window.__exegolQaActions = [];
  var actions = window.__exegolQaActions;
  var consoleErrors = [];
  window.__exegolQaConsoleErrors = consoleErrors;

  ${buildSelectorSource()}

  // --- Click handler ---
  function onClickCapture(e) {
    var target = e.target;
    if (!target || !target.tagName) return;
    actions.push({
      type: "click",
      timestamp: Date.now(),
      selector: __exegolBuildSelector(target),
      coordinates: { x: Math.round(e.clientX), y: Math.round(e.clientY) }
    });
  }

  // --- Input handler (debounced per element) ---
  var inputTimers = new WeakMap();
  function onInputCapture(e) {
    var target = e.target;
    if (!target || !target.tagName) return;
    var tag = target.tagName.toLowerCase();
    if (tag !== "input" && tag !== "textarea" && !target.isContentEditable) return;

    // Clear previous debounce for this element
    var prev = inputTimers.get(target);
    if (prev) clearTimeout(prev);

    inputTimers.set(target, setTimeout(function() {
      inputTimers.delete(target);
      var value = target.isContentEditable ? target.textContent : target.value;
      actions.push({
        type: "input",
        timestamp: Date.now(),
        selector: __exegolBuildSelector(target),
        value: value || ""
      });
    }, 500));
  }

  // --- Keypress handler (non-printable keys only) ---
  function onKeypressCapture(e) {
    // Only capture special keys (Enter, Escape, Tab, arrows)
    var special = ["Enter", "Escape", "Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
                   "Backspace", "Delete", "Home", "End", "PageUp", "PageDown"];
    if (special.indexOf(e.key) === -1) return;
    var target = e.target;
    actions.push({
      type: "keypress",
      timestamp: Date.now(),
      selector: target ? __exegolBuildSelector(target) : "body",
      value: e.key
    });
  }

  // --- Navigation handler ---
  var lastUrl = location.href;
  function checkNavigation() {
    if (location.href !== lastUrl) {
      actions.push({
        type: "navigate",
        timestamp: Date.now(),
        selector: "",
        url: location.href
      });
      lastUrl = location.href;
    }
  }
  var navInterval = setInterval(checkNavigation, 200);

  // Also listen to popstate and hashchange
  function onNavEvent() {
    setTimeout(checkNavigation, 0);
  }

  // --- Console.error capture ---
  var origError = console.error;
  console.error = function() {
    var args = Array.from(arguments).map(function(a) {
      try { return typeof a === "string" ? a : JSON.stringify(a); }
      catch(_) { return String(a); }
    });
    consoleErrors.push(args.join(" "));
    origError.apply(console, arguments);
  };

  // --- Attach listeners ---
  document.addEventListener("click", onClickCapture, true);
  document.addEventListener("input", onInputCapture, true);
  document.addEventListener("keydown", onKeypressCapture, true);
  window.addEventListener("popstate", onNavEvent);
  window.addEventListener("hashchange", onNavEvent);

  // --- Disable / cleanup ---
  window.__exegolQaDisable = function() {
    document.removeEventListener("click", onClickCapture, true);
    document.removeEventListener("input", onInputCapture, true);
    document.removeEventListener("keydown", onKeypressCapture, true);
    window.removeEventListener("popstate", onNavEvent);
    window.removeEventListener("hashchange", onNavEvent);
    clearInterval(navInterval);
    console.error = origError;
    // Keep data accessible for extraction but stop recording
  };
})();`;

// ---------------------------------------------------------------------------
// Playwright export
// ---------------------------------------------------------------------------

/** Escape a string for use in a JS template literal (single quotes). */
function escapeJsString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n").replace(/\r/g, "\\r");
}

/**
 * Generate a Playwright test script from a QA recording.
 *
 * Produces an `import { test, expect } from '@playwright/test'` script
 * with `page.goto`, `page.click`, `page.fill`, `page.press`, etc.
 */
export function exportToPlaywright(recording: QaRecording): string {
  const lines: string[] = [
    "import { test, expect } from '@playwright/test';",
    "",
    "test('recorded flow', async ({ page }) => {",
    `  await page.goto('${escapeJsString(recording.startUrl)}');`,
  ];

  for (const action of recording.actions) {
    switch (action.type) {
      case "click":
        if (action.selector) {
          lines.push(`  await page.click('${escapeJsString(action.selector)}');`);
        }
        break;

      case "input":
        if (action.selector && action.value !== undefined) {
          lines.push(
            `  await page.fill('${escapeJsString(action.selector)}', '${escapeJsString(action.value)}');`,
          );
        }
        break;

      case "keypress":
        if (action.value) {
          lines.push(
            `  await page.press('${escapeJsString(action.selector || "body")}', '${escapeJsString(action.value)}');`,
          );
        }
        break;

      case "navigate":
        if (action.url) {
          lines.push(`  await page.goto('${escapeJsString(action.url)}');`);
        }
        break;

      case "scroll":
        // Scroll actions are informational — no direct Playwright mapping
        lines.push(`  // scroll at ${action.selector}`);
        break;
    }
  }

  lines.push("});", "");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Agent prompt formatter
// ---------------------------------------------------------------------------

/** Human-readable label for an action type. */
function actionLabel(type: QaActionType): string {
  switch (type) {
    case "click":
      return "CLICK";
    case "input":
      return "INPUT";
    case "navigate":
      return "NAVIGATE";
    case "scroll":
      return "SCROLL";
    case "keypress":
      return "KEYPRESS";
  }
}

/** Format a single action as a one-line description. */
function formatAction(action: QaAction, index: number): string {
  const num = `${index + 1}.`;
  const label = actionLabel(action.type);

  switch (action.type) {
    case "click": {
      const coords = action.coordinates
        ? ` (${action.coordinates.x}, ${action.coordinates.y})`
        : "";
      return `${num} ${label} ${action.selector}${coords}`;
    }
    case "input":
      return `${num} ${label} ${action.selector} → "${action.value ?? ""}"`;
    case "navigate":
      return `${num} ${label} → ${action.url ?? "unknown"}`;
    case "keypress":
      return `${num} ${label} ${action.selector} → [${action.value ?? ""}]`;
    case "scroll":
      return `${num} ${label} ${action.selector}`;
  }
}

/**
 * Format a recording as a structured prompt for an AI agent.
 *
 * Output example:
 * ```
 * [QA Recording] 5 actions recorded at http://localhost:3000
 * 1. CLICK .hero-section > button (120, 340)
 * 2. INPUT #email-input → "test@example.com"
 * ...
 *
 * Console errors during flow:
 * - TypeError: Cannot read property 'foo' of undefined
 *
 * Generate a Playwright test that reproduces this flow and add assertions for expected behavior.
 * ```
 */
export function formatRecordingForAgent(recording: QaRecording): string {
  const parts: string[] = [];

  // Header
  const count = recording.actions.length;
  parts.push(
    `[QA Recording] ${count} action${count === 1 ? "" : "s"} recorded at ${recording.startUrl}`,
  );

  // Action list
  for (let i = 0; i < recording.actions.length; i++) {
    const action = recording.actions[i];
    if (action) parts.push(formatAction(action, i));
  }

  // Console errors
  if (recording.consoleErrors.length > 0) {
    parts.push("");
    parts.push("Console errors during flow:");
    for (const err of recording.consoleErrors) {
      parts.push(`- ${err}`);
    }
  }

  // Instruction
  parts.push("");
  parts.push(
    "Generate a Playwright test that reproduces this flow and add assertions for expected behavior.",
  );

  return parts.join("\n");
}
