import { useCallback, useEffect, useRef, useState } from "react";
import { type CapturedElement, DESIGN_MODE_INJECTION_SCRIPT } from "../../lib/design-capture";
import { QA_MODE_INJECTION_SCRIPT, type QaRecording } from "../../lib/qa-recorder";

const DESIGN_POLL_INTERVAL_MS = 300;
const DESIGN_AUTO_STOP_MS = 60_000;

interface UseDesignQaModesParams {
  /** Runs JS in the page; resolves null when the webview refuses it */
  safeExecJs: (code: string) => Promise<unknown>;
  currentUrl: string;
  /** Called as QA recording starts, after the previous recording is cleared */
  onQaStart?: () => void;
}

/**
 * T102: Design Mode (pick an element to report) and QA Mode (record interactions)
 * on a webview. The two are exclusive: turning one on turns the other off.
 * Shared by the browser pane and the floating browser window.
 */
export function useDesignQaModes({ safeExecJs, currentUrl, onQaStart }: UseDesignQaModesParams) {
  const [designMode, setDesignMode] = useState(false);
  const [qaMode, setQaMode] = useState(false);
  const [capturedElement, setCapturedElement] = useState<CapturedElement | null>(null);
  const [qaRecording, setQaRecording] = useState<QaRecording | null>(null);
  const [qaActionCount, setQaActionCount] = useState(0);

  const designPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const designAutoStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup design mode poll and auto-stop timeout on unmount
  useEffect(() => {
    return () => {
      if (designPollRef.current) clearInterval(designPollRef.current);
      if (designAutoStopRef.current) clearTimeout(designAutoStopRef.current);
    };
  }, []);

  // T102: Toggle Design Mode — inject/remove selection overlay in webview
  const toggleDesignMode = useCallback(async () => {
    if (designMode) {
      await safeExecJs("window.__exegolDesignDisable?.()");
      setDesignMode(false);
      if (designPollRef.current) {
        clearInterval(designPollRef.current);
        designPollRef.current = null;
      }
      if (designAutoStopRef.current) {
        clearTimeout(designAutoStopRef.current);
        designAutoStopRef.current = null;
      }
    } else {
      if (qaMode) {
        await safeExecJs("window.__exegolQaDisable?.()");
        setQaMode(false);
      }
      await safeExecJs(DESIGN_MODE_INJECTION_SCRIPT);
      setDesignMode(true);
      setCapturedElement(null);
      // Poll for captured element with proper cleanup
      if (designPollRef.current) clearInterval(designPollRef.current);
      designPollRef.current = setInterval(async () => {
        const result = await safeExecJs("window.__exegolDesignCapture");
        if (result) {
          if (designPollRef.current) {
            clearInterval(designPollRef.current);
            designPollRef.current = null;
          }
          await safeExecJs("window.__exegolDesignDisable?.()");
          setDesignMode(false);
          setCapturedElement(result as CapturedElement);
        }
      }, DESIGN_POLL_INTERVAL_MS);
      if (designAutoStopRef.current) clearTimeout(designAutoStopRef.current);
      designAutoStopRef.current = setTimeout(() => {
        if (designPollRef.current) {
          clearInterval(designPollRef.current);
          designPollRef.current = null;
        }
        designAutoStopRef.current = null;
      }, DESIGN_AUTO_STOP_MS);
    }
  }, [designMode, qaMode, safeExecJs]);

  // T102: Poll QA action count while recording
  useEffect(() => {
    if (!qaMode) {
      setQaActionCount(0);
      return;
    }
    const poll = setInterval(async () => {
      const count = await safeExecJs("window.__exegolQaActions?.length ?? 0");
      if (typeof count === "number") setQaActionCount((prev) => (prev === count ? prev : count));
    }, 500);
    return () => clearInterval(poll);
  }, [qaMode, safeExecJs]);

  // T102: Toggle QA Mode — inject/remove interaction recorder in webview
  const toggleQaMode = useCallback(async () => {
    if (qaMode) {
      const actions = await safeExecJs("window.__exegolQaActions");
      const errors = await safeExecJs("window.__exegolQaConsoleErrors");
      await safeExecJs("window.__exegolQaDisable?.()");
      setQaMode(false);
      if (Array.isArray(actions) && actions.length > 0) {
        setQaRecording({
          startUrl: currentUrl,
          startedAt: Date.now(),
          actions: actions as QaRecording["actions"],
          consoleErrors: (errors as string[]) ?? [],
        });
      }
    } else {
      if (designMode) {
        await safeExecJs("window.__exegolDesignDisable?.()");
        setDesignMode(false);
      }
      await safeExecJs(QA_MODE_INJECTION_SCRIPT);
      setQaMode(true);
      setQaRecording(null);
      onQaStart?.();
    }
  }, [qaMode, designMode, currentUrl, safeExecJs, onQaStart]);

  return {
    designMode,
    qaMode,
    capturedElement,
    setCapturedElement,
    qaRecording,
    setQaRecording,
    qaActionCount,
    toggleDesignMode,
    toggleQaMode,
  };
}
