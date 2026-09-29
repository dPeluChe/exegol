import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import type { QaRecording } from "../../lib/qa-recorder";
import type { QaStepResult } from "../../lib/qa-replay";
import { trpcMutate } from "../../lib/trpc-client";
import { useWorkspaceStore } from "../../stores/workspace";
import { useDesignQaModes } from "./use-design-qa-modes";
import { useQaReplay } from "./use-qa-replay";

const QA_NAV_DELAY_MS = 800;

interface UseBrowserQaParams {
  paneId: string;
  projectId: string | null;
  currentUrl: string;
  goTo: (url: string) => void;
  webviewRef: React.RefObject<HTMLElement | null>;
}

/** This pane's webview: with two browser panes the window's first one answered */
function webviewIdOf(ref: React.RefObject<HTMLElement | null>): number | undefined {
  return (
    ref.current as unknown as { getWebContentsId?: () => number } | null
  )?.getWebContentsId?.();
}

export function useBrowserQa({
  paneId,
  projectId,
  currentUrl,
  goTo,
  webviewRef,
}: UseBrowserQaParams) {
  const queryClient = useQueryClient();

  const [savingTest, setSavingTest] = useState(false);
  const [testName, setTestName] = useState("");
  const [savedTestId, setSavedTestId] = useState<string | null>(null);
  const clearSavedTestId = useCallback(() => setSavedTestId(null), []);
  const [stopOnFail, setStopOnFail] = useState(true);

  // T102: Safe executeJs wrapper — catches CSP blocks and webview errors
  const safeExecJs = useCallback(
    async (code: string): Promise<unknown> => {
      try {
        return (await window.api.browser?.executeJs(code, webviewIdOf(webviewRef))) ?? null;
      } catch (err) {
        console.warn("[BrowserPane] executeJs failed:", err);
        return null;
      }
    },
    [webviewRef],
  );

  const modes = useDesignQaModes({ safeExecJs, currentUrl, onQaStart: clearSavedTestId });
  const { qaRecording, setQaRecording } = modes;
  const { runReplay, setReplayResult, ...replay } = useQaReplay(safeExecJs);

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
  }, [qaRecording, projectId, testName, setQaRecording, setReplayResult]);

  // T102: Replay a QA recording against the webview (with cancel + stop-on-fail + persist)
  const handleReplay = useCallback(
    async (overrideActions?: QaRecording["actions"], overrideTestId?: string) => {
      const actions = overrideActions ?? qaRecording?.actions;
      if (!actions) return;
      const result = await runReplay(actions, {
        stopOnFail,
        captureScreenshot: async () => {
          try {
            return (await window.api.browser?.captureScreenshot(webviewIdOf(webviewRef))) ?? null;
          } catch {
            return null;
          }
        },
      });
      // Persist run to DB if we have a saved test ID
      const testId = overrideTestId ?? savedTestId;
      if (!result || !testId) return;
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
    },
    [qaRecording, runReplay, stopOnFail, savedTestId, queryClient, webviewRef],
  );

  // Listen for run-test events dispatched by QaTestsSection
  // Only the focused pane responds — prevents multiple panes from running simultaneously
  useEffect(() => {
    const handler = async (e: Event) => {
      const { testId, startUrl, actions, paneId: target } = (e as CustomEvent).detail ?? {};
      if (!testId || !actions) return;
      // The section names the pane; the focused one answers an event without a target
      if ((target ?? useWorkspaceStore.getState().focusedPaneId) !== paneId) return;
      goTo(startUrl);
      await new Promise((r) => setTimeout(r, QA_NAV_DELAY_MS));
      setQaRecording({ startUrl, startedAt: Date.now(), actions, consoleErrors: [] });
      setSavedTestId(testId);
      handleReplay(actions, testId);
    };
    window.addEventListener("exegol:qa-run-test", handler);
    return () => window.removeEventListener("exegol:qa-run-test", handler);
  }, [handleReplay, paneId, goTo, setQaRecording]);

  return {
    ...modes,
    ...replay,
    setReplayResult,
    savingTest,
    testName,
    setTestName,
    savedTestId,
    setSavedTestId,
    stopOnFail,
    setStopOnFail,
    handleSaveTest,
    handleReplay,
  };
}
