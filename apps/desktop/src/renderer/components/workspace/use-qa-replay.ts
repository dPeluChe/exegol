import { useCallback, useRef, useState } from "react";
import type { QaRecording } from "../../lib/qa-recorder";
import { type QaReplayResult, replayQaTest } from "../../lib/qa-replay";

interface ReplayOptions {
  stopOnFail: boolean;
  captureScreenshot: () => Promise<string | null>;
}

/** T102: replays recorded QA actions through safeExecJs, with a step counter and cancel */
export function useQaReplay(safeExecJs: (code: string) => Promise<unknown>) {
  const [replaying, setReplaying] = useState(false);
  const [replayStep, setReplayStep] = useState(-1);
  const [replayResult, setReplayResult] = useState<QaReplayResult | null>(null);
  const cancelledRef = useRef(false);

  /** Resolves the result, or null when already replaying, cancelled or failed */
  const runReplay = useCallback(
    async (
      actions: QaRecording["actions"],
      { stopOnFail, captureScreenshot }: ReplayOptions,
    ): Promise<QaReplayResult | null> => {
      if (replaying) return null;
      setReplaying(true);
      setReplayResult(null);
      setReplayStep(-1);
      cancelledRef.current = false;
      try {
        const result = await replayQaTest(
          actions,
          async (code) => {
            if (cancelledRef.current) throw new Error("Replay cancelled");
            return await safeExecJs(code);
          },
          captureScreenshot,
          { onStepStart: (index) => setReplayStep(index) },
          { stopOnFail },
        );
        setReplayResult(result);
        return result;
      } catch (err) {
        console.error("[QaReplay] Replay failed:", err);
        return null;
      } finally {
        setReplaying(false);
        setReplayStep(-1);
      }
    },
    [replaying, safeExecJs],
  );

  const cancelReplay = useCallback(() => {
    cancelledRef.current = true;
  }, []);

  return { replaying, replayStep, replayResult, setReplayResult, runReplay, cancelReplay };
}
