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
  /** Texts from [role="alert"] and aria-invalid described-by elements detected after this step. */
  alertsDetected?: string[];
  /** console.error calls that occurred during this specific step. */
  newConsoleErrors?: string[];
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

export interface QaReplayOptions {
  /** Stop executing further steps on the first failure. Default: false. */
  stopOnFail?: boolean;
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

  window.__exegolQaReplayClick = function(selector) {
    return waitForSelector(selector, TIMEOUT).then(function(found) {
      if (!found) throw new Error("Element not found: " + selector);
      var el = document.querySelector(selector);
      // Scroll into view first so off-screen elements are reachable
      el.scrollIntoView({ block: 'nearest', behavior: 'instant' });
      var rect = el.getBoundingClientRect();
      // Always use element's current center — stored coords are viewport-specific
      var clientX = Math.round(rect.left + rect.width / 2);
      var clientY = Math.round(rect.top + rect.height / 2);

      // Visual cursor dot so the user can see where each click lands
      var dot = document.createElement('div');
      dot.style.cssText = 'position:fixed;z-index:2147483647;width:18px;height:18px;border-radius:50%;background:rgba(239,68,68,0.75);border:2px solid rgba(255,255,255,0.9);box-shadow:0 0 0 4px rgba(239,68,68,0.25);transform:translate(-50%,-50%);pointer-events:none;transition:opacity 0.35s ease-out;left:' + clientX + 'px;top:' + clientY + 'px';
      document.documentElement.appendChild(dot);
      setTimeout(function() { dot.style.opacity = '0'; }, 350);
      setTimeout(function() { if (dot.parentNode) dot.parentNode.removeChild(dot); }, 700);

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

  // Returns count of console errors captured so far (for per-step delta)
  window.__exegolQaReplayGetErrorCount = function() {
    return __replayErrors.length;
  };

  // Returns console errors captured since index idx
  window.__exegolQaReplayGetErrorsSince = function(idx) {
    return __replayErrors.slice(idx);
  };

  // Collect visible alert/error texts from the DOM
  window.__exegolQaGetAlerts = function() {
    var texts = [];
    // Standard ARIA alerts and assertive live regions
    document.querySelectorAll('[role="alert"], [aria-live="assertive"]').forEach(function(el) {
      var t = el.textContent && el.textContent.trim();
      if (t) texts.push(t);
    });
    // Fields marked invalid — resolve their aria-describedby error message
    document.querySelectorAll('[aria-invalid="true"]').forEach(function(el) {
      var descId = el.getAttribute('aria-describedby');
      if (descId) {
        descId.split(/\\s+/).forEach(function(id) {
          var desc = document.getElementById(id);
          var t = desc && desc.textContent && desc.textContent.trim();
          if (t) texts.push(t);
        });
      }
    });
    // Deduplicate
    return texts.filter(function(t, i, a) { return a.indexOf(t) === i; });
  };

  // Assert an element exists, optionally containing specific text
  window.__exegolQaReplayAssert = function(selector, expectedText) {
    var el = document.querySelector(selector);
    if (!el) throw new Error('Assert failed — element not found: ' + selector);
    if (expectedText !== undefined) {
      var text = (el.textContent || '').trim();
      if (text.indexOf(expectedText) === -1) {
        throw new Error(
          'Assert failed — expected "' + expectedText + '" in <' +
          el.tagName.toLowerCase() + '>, got: "' + text.slice(0, 120) + '"'
        );
      }
    }
    return true;
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
    case "click":
      return `window.__exegolQaReplayClick('${escapeJs(action.selector)}')`;

    case "input":
      return `window.__exegolQaReplayFill('${escapeJs(action.selector)}', '${escapeJs(action.value ?? "")}')`;

    case "keypress":
      return `window.__exegolQaReplayPress('${escapeJs(action.value ?? "")}')`;

    case "navigate":
      return `window.__exegolQaReplayNavigate('${escapeJs(action.url ?? "")}')`;

    case "assert": {
      const text = action.value ? `, '${escapeJs(action.value)}'` : "";
      return `window.__exegolQaReplayAssert('${escapeJs(action.selector)}'${text})`;
    }

    case "scroll":
      // Scroll actions are informational during recording; skip during replay.
      return "Promise.resolve(true)";
  }
}

/** Small helper to wait a given number of milliseconds. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Race a promise against a timeout; resolves to null on timeout. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
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
  options?: QaReplayOptions,
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
    let alertsDetected: string[] | undefined;
    let newConsoleErrors: string[] | undefined;

    const isNoOp = action.type === "scroll";

    // Snapshot error count before the step to compute per-step delta after.
    let errorCountBefore = 0;
    if (!isNoOp) {
      try {
        const n = await executeJs("window.__exegolQaReplayGetErrorCount()");
        if (typeof n === "number") errorCountBefore = n;
      } catch {
        // ignore — may not be injected yet on first step
      }
    }

    try {
      const expression = buildStepExpression(action);
      await executeJs(`(async () => { await ${expression}; })()`);
      passed = true;
    } catch (err: unknown) {
      passed = false;
      error = err instanceof Error ? err.message : String(err);
    }

    if (!isNoOp) {
      // Wait for DOM to settle (react to state changes, animations, etc.)
      await delay(INTER_STEP_DELAY_MS);

      // Capture alerts, console errors, and screenshot concurrently.
      const [alertsResult, errorsResult, shotResult] = await Promise.allSettled([
        executeJs("window.__exegolQaGetAlerts()"),
        executeJs(`window.__exegolQaReplayGetErrorsSince(${errorCountBefore})`),
        withTimeout(captureScreenshot(), 3_000),
      ]);
      if (
        alertsResult.status === "fulfilled" &&
        Array.isArray(alertsResult.value) &&
        alertsResult.value.length > 0
      ) {
        alertsDetected = alertsResult.value as string[];
      }
      if (
        errorsResult.status === "fulfilled" &&
        Array.isArray(errorsResult.value) &&
        errorsResult.value.length > 0
      ) {
        newConsoleErrors = errorsResult.value as string[];
      }
      if (shotResult.status === "fulfilled" && shotResult.value) {
        screenshotBase64 = shotResult.value;
      }
    }

    const result: QaStepResult = {
      actionIndex: i,
      action,
      passed,
      error,
      screenshotBase64,
      durationMs: Date.now() - stepStart,
      alertsDetected,
      newConsoleErrors,
    };

    stepResults.push(result);
    callbacks?.onStepComplete?.(result);

    if (!passed && options?.stopOnFail) break;
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
