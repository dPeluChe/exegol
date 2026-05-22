import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { type CapturedElement, DESIGN_MODE_INJECTION_SCRIPT } from "../../lib/design-capture";
import { QA_MODE_INJECTION_SCRIPT, type QaRecording } from "../../lib/qa-recorder";
import { type QaReplayResult, type QaStepResult, replayQaTest } from "../../lib/qa-replay";
import { trpcMutate } from "../../lib/trpc-client";
import { useWorkspaceStore } from "../../stores/workspace";

const DESIGN_POLL_INTERVAL_MS = 300;
const DESIGN_AUTO_STOP_MS = 60_000;
const QA_NAV_DELAY_MS = 800;

interface UseBrowserQaParams {
  paneId: string;
  paneInternalId: string;
  projectId: string | null;
  currentUrl: string;
  setUrlInput: (v: string) => void;
  setCurrentUrl: (v: string) => void;
  updatePane: (id: string, updates: { url: string }) => void;
}

export function useBrowserQa({
  paneId,
  paneInternalId,
  projectId,
  currentUrl,
  setUrlInput,
  setCurrentUrl,
  updatePane,
}: UseBrowserQaParams) {
  const queryClient = useQueryClient();

  const [designMode, setDesignMode] = useState(false);
  const [qaMode, setQaMode] = useState(false);
  const [capturedElement, setCapturedElement] = useState<CapturedElement | null>(null);
  const [qaRecording, setQaRecording] = useState<QaRecording | null>(null);
  const [replayResult, setReplayResult] = useState<QaReplayResult | null>(null);
  const [replaying, setReplaying] = useState(false);
  const [replayStep, setReplayStep] = useState<number>(-1);
  const [savingTest, setSavingTest] = useState(false);
  const [testName, setTestName] = useState("");
  const [savedTestId, setSavedTestId] = useState<string | null>(null);
  const [stopOnFail, setStopOnFail] = useState(true);
  const [qaActionCount, setQaActionCount] = useState(0);

  const designPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const designAutoStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const replayCancelledRef = useRef(false);

  // Cleanup design mode poll and auto-stop timeout on unmount
  useEffect(() => {
    return () => {
      if (designPollRef.current) clearInterval(designPollRef.current);
      if (designAutoStopRef.current) clearTimeout(designAutoStopRef.current);
    };
  }, []);

  // T102: Safe executeJs wrapper — catches CSP blocks and webview errors
  const safeExecJs = useCallback(async (code: string): Promise<unknown> => {
    try {
      return (await window.api.browser?.executeJs(code)) ?? null;
    } catch (err) {
      console.warn("[BrowserPane] executeJs failed:", err);
      return null;
    }
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
      setSavedTestId(null);
    }
  }, [qaMode, designMode, currentUrl, safeExecJs]);

  // T102: Save QA recording as a reusable test
  const handleSaveTest = useCallback(async () => {
    if (!qaRecording || !projectId || !testName.trim()) return;
    setSavingTest(true);
    try {
      // biome-ignore lint/suspicious/noExplicitAny: tRPC dynamic shape
      const saved = await trpcMutate<any>("qaTests.save", {
        projectId,
        name: testName.trim(),
        startUrl: qaRecording.startUrl,
        actions: JSON.stringify(qaRecording.actions),
      });
      setSavedTestId(saved?.id ?? null);
      setQaRecording(null);
      setReplayResult(null);
      setTestName("");
    } catch (err) {
      console.error("[BrowserPane] Save test failed:", err);
    } finally {
      setSavingTest(false);
    }
  }, [qaRecording, projectId, testName]);

  // T102: Replay a QA recording against the webview (with cancel + stop-on-fail + persist)
  const handleReplay = useCallback(
    async (overrideActions?: QaRecording["actions"], overrideTestId?: string) => {
      const actions = overrideActions ?? qaRecording?.actions;
      if (!actions || replaying) return;
      setReplaying(true);
      setReplayResult(null);
      setReplayStep(-1);
      replayCancelledRef.current = false;
      try {
        const executeJs = async (code: string) => {
          if (replayCancelledRef.current) throw new Error("Replay cancelled");
          return await safeExecJs(code);
        };
        const captureScreenshot = async () => {
          try {
            return (await window.api.browser?.captureScreenshot()) ?? null;
          } catch {
            return null;
          }
        };
        const result = await replayQaTest(
          actions,
          executeJs,
          captureScreenshot,
          { onStepStart: (index) => setReplayStep(index) },
          { stopOnFail },
        );
        setReplayResult(result);
        // Persist run to DB if we have a saved test ID
        const testId = overrideTestId ?? savedTestId;
        if (testId) {
          try {
            await trpcMutate("qaTests.saveRun", {
              testId,
              passed: result.passed,
              stepResults: JSON.stringify(
                result.stepResults.map((s: QaStepResult) => ({
                  actionIndex: s.actionIndex,
                  passed: s.passed,
                  error: s.error,
                  durationMs: s.durationMs,
                })),
              ),
              consoleErrors: JSON.stringify(result.consoleErrors),
              durationMs: result.totalDurationMs,
            });
            // Refresh QA Tests panel so lastStatus updates immediately
            queryClient.invalidateQueries({ queryKey: ["qaTests"] });
            queryClient.invalidateQueries({ queryKey: ["qaLatestRun", testId] });
          } catch (err) {
            console.warn("[BrowserPane] Failed to persist run:", err);
          }
        }
      } catch (err) {
        console.error("[BrowserPane] Replay failed:", err);
      } finally {
        setReplaying(false);
        setReplayStep(-1);
      }
    },
    [qaRecording, replaying, safeExecJs, stopOnFail, savedTestId, queryClient],
  );

  const cancelReplay = useCallback(() => {
    replayCancelledRef.current = true;
  }, []);

  // Listen for run-test events dispatched by QaTestsSection
  // Only the focused pane responds — prevents multiple panes from running simultaneously
  useEffect(() => {
    const handler = async (e: Event) => {
      const { testId, startUrl, actions } = (e as CustomEvent).detail ?? {};
      if (!testId || !actions) return;
      const focusedId = useWorkspaceStore.getState().focusedPaneId;
      if (focusedId !== paneId) return;
      setUrlInput(startUrl);
      setCurrentUrl(startUrl);
      updatePane(paneInternalId, { url: startUrl });
      await new Promise((r) => setTimeout(r, QA_NAV_DELAY_MS));
      setQaRecording({ startUrl, startedAt: Date.now(), actions, consoleErrors: [] });
      setSavedTestId(testId);
      handleReplay(actions, testId);
    };
    window.addEventListener("exegol:qa-run-test", handler);
    return () => window.removeEventListener("exegol:qa-run-test", handler);
  }, [handleReplay, paneId, paneInternalId, setUrlInput, setCurrentUrl, updatePane]);

  return {
    designMode,
    qaMode,
    capturedElement,
    setCapturedElement,
    qaRecording,
    setQaRecording,
    replayResult,
    setReplayResult,
    replaying,
    replayStep,
    savingTest,
    testName,
    setTestName,
    savedTestId,
    setSavedTestId,
    stopOnFail,
    setStopOnFail,
    qaActionCount,
    toggleDesignMode,
    toggleQaMode,
    handleSaveTest,
    handleReplay,
    cancelReplay,
  };
}
