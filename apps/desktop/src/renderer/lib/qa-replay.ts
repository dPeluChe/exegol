/**
 * T102: QA Test Replay Engine.
 *
 * Executes recorded QA flows against a webview by injecting replay
 * functions and driving them step-by-step through the provided
 * executeJs / captureScreenshot callbacks.
 *
 * No external dependencies — pure TypeScript.
 */

import type { QaAction } from "./qa-recorder";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QaStepResult {
  actionIndex: number;
  action: QaAction;
  passed: boolean;
  error?: string;
  screenshotBase64?: string;
  durationMs: number;
}

export interface QaReplayResult {
  passed: boolean;
  stepResults: QaStepResult[];
  consoleErrors: string[];
  totalDurationMs: number;
}

export interface QaReplayCallbacks {
  onStepStart?: (index: number, action: QaAction) => void;
  onStepComplete?: (result: QaStepResult) => void;
  onComplete?: (result: QaReplayResult) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Time to wait between actions for the DOM to settle (ms). */
const INTER_STEP_DELAY_MS = 500;

/** Timeout for finding a selector before marking the step as failed (ms). */
const SELECTOR_TIMEOUT_MS = 5000;

// ---------------------------------------------------------------------------
// Injection script
// ---------------------------------------------------------------------------

/**
 * JavaScript source to inject into the webview before replay begins.
 *
 * Exposes:
 * - `window.__exegolQaReplayClick(selector, x, y)` — click element
 * - `window.__exegolQaReplayFill(selector, value)` — fill input
 * - `window.__exegolQaReplayPress(key)` — dispatch keypress
 * - `window.__exegolQaReplayNavigate(url)` — navigate
 * - `window.__exegolQaReplayGetErrors()` — return captured console.error array
 *
 * Monkey-patches `console.error` to capture errors during replay.
 */
export const QA_REPLAY_INJECTION_SCRIPT = `(function() {
  "use strict";
  if (window.__exegolQaReplayClick) return; // already injected

  // --- Console error capture ---
  var __replayErrors = [];
  var __origConsoleError = console.error;
  console.error = function() {
    var args = Array.from(arguments).map(function(a) {
      try { return typeof a === "string" ? a : JSON.stringify(a); }
      catch(_) { return String(a); }
    });
    __replayErrors.push(args.join(" "));
    __origConsoleError.apply(console, arguments);
  };

  // --- Shared helpers ---
  var TIMEOUT = ${SELECTOR_TIMEOUT_MS};

  function waitForSelector(selector, timeout) {
    var start = Date.now();
    return new Promise(function(resolve) {
      (function poll() {
        if (document.querySelector(selector)) return resolve(true);
        if (Date.now() - start >= timeout) return resolve(false);
        setTimeout(poll, 100);
      })();
    });
  }

  // --- Replay functions ---

  window.__exegolQaReplayClick = function(selector, x, y) {
    return waitForSelector(selector, TIMEOUT).then(function(found) {
      if (!found) throw new Error("Element not found: " + selector);
      var el = document.querySelector(selector);
      var rect = el.getBoundingClientRect();
      var clientX = typeof x === "number" ? x : Math.round(rect.left + rect.width / 2);
      var clientY = typeof y === "number" ? y : Math.round(rect.top + rect.height / 2);
      el.dispatchEvent(new MouseEvent("click", {
        bubbles: true, cancelable: true, view: window,
        clientX: clientX, clientY: clientY
      }));
      return true;
    });
  };

  window.__exegolQaReplayFill = function(selector, value) {
    return waitForSelector(selector, TIMEOUT).then(function(found) {
      if (!found) throw new Error("Element not found: " + selector);
      var el = document.querySelector(selector);
      if (el.isContentEditable) {
        el.textContent = value;
      } else {
        // Use native setter to work with React controlled inputs
        var nativeSetter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype, "value"
        ) || Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype, "value"
        );
        if (nativeSetter && nativeSetter.set) {
          nativeSetter.set.call(el, value);
        } else {
          el.value = value;
        }
      }
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    });
  };

  window.__exegolQaReplayPress = function(key) {
    var opts = { key: key, bubbles: true, cancelable: true };
    document.activeElement.dispatchEvent(new KeyboardEvent("keydown", opts));
    document.activeElement.dispatchEvent(new KeyboardEvent("keyup", opts));
    return Promise.resolve(true);
  };

  window.__exegolQaReplayNavigate = function(url) {
    window.location.href = url;
    return Promise.resolve(true);
  };

  window.__exegolQaReplayGetErrors = function() {
    return __replayErrors.slice();
  };
})();`;

// ---------------------------------------------------------------------------
// Replay executor
// ---------------------------------------------------------------------------

/** Escape a string for safe embedding inside a JS string literal. */
function escapeJs(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r");
}

/** Build the JS expression to execute in the webview for a given action. */
function buildStepExpression(action: QaAction): string {
  switch (action.type) {
    case "click": {
      const x = action.coordinates?.x ?? "undefined";
      const y = action.coordinates?.y ?? "undefined";
      return `window.__exegolQaReplayClick('${escapeJs(action.selector)}', ${x}, ${y})`;
    }

    case "input":
      return `window.__exegolQaReplayFill('${escapeJs(action.selector)}', '${escapeJs(action.value ?? "")}')`;

    case "keypress":
      return `window.__exegolQaReplayPress('${escapeJs(action.value ?? "")}')`;

    case "navigate":
      return `window.__exegolQaReplayNavigate('${escapeJs(action.url ?? "")}')`;

    case "scroll":
      // Scroll actions are informational during recording; skip during replay.
      return "Promise.resolve(true)";
  }
}

/** Small helper to wait a given number of milliseconds. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Replay a sequence of recorded QA actions against a webview.
 *
 * @param actions       - The actions to replay (from a QaRecording).
 * @param executeJs     - Runs arbitrary JS inside the webview and returns the result.
 *                        Typically `window.api.browser.executeJs`.
 * @param captureScreenshot - Captures the current webview as a base64 PNG string.
 *                        Typically `window.api.browser.captureScreenshot`.
 * @param callbacks     - Optional lifecycle callbacks for progress reporting.
 * @returns A full QaReplayResult with per-step outcomes.
 */
export async function replayQaTest(
  actions: QaAction[],
  executeJs: (code: string) => Promise<unknown>,
  captureScreenshot: () => Promise<string | null>,
  callbacks?: QaReplayCallbacks,
): Promise<QaReplayResult> {
  const totalStart = Date.now();
  const stepResults: QaStepResult[] = [];

  // 1. Inject the replay helper functions into the webview.
  await executeJs(QA_REPLAY_INJECTION_SCRIPT);

  // 2. Execute each action sequentially.
  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    if (!action) continue;

    callbacks?.onStepStart?.(i, action);
    const stepStart = Date.now();

    let passed = false;
    let error: string | undefined;
    let screenshotBase64: string | undefined;

    try {
      const expression = buildStepExpression(action);
      await executeJs(`(async () => { await ${expression}; })()`);
      passed = true;
    } catch (err: unknown) {
      passed = false;
      error = err instanceof Error ? err.message : String(err);
    }

    // Wait for DOM to settle before capturing screenshot / next step.
    await delay(INTER_STEP_DELAY_MS);

    // Capture screenshot (best-effort, don't fail the step if this errors).
    try {
      const shot = await captureScreenshot();
      if (shot) screenshotBase64 = shot;
    } catch {
      // Screenshot capture is non-critical.
    }

    const result: QaStepResult = {
      actionIndex: i,
      action,
      passed,
      error,
      screenshotBase64,
      durationMs: Date.now() - stepStart,
    };

    stepResults.push(result);
    callbacks?.onStepComplete?.(result);
  }

  // 3. Collect console errors captured during replay.
  let consoleErrors: string[] = [];
  try {
    const errors = await executeJs("window.__exegolQaReplayGetErrors()");
    if (Array.isArray(errors)) {
      consoleErrors = errors as string[];
    }
  } catch {
    // If we can't retrieve errors (e.g. page navigated away), that's fine.
  }

  // 4. Build final result.
  const replayResult: QaReplayResult = {
    passed: stepResults.every((r) => r.passed),
    stepResults,
    consoleErrors,
    totalDurationMs: Date.now() - totalStart,
  };

  callbacks?.onComplete?.(replayResult);

  return replayResult;
}
