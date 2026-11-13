import { ENDED_STATUSES } from "@exegol/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { useScrollback } from "../../hooks/use-trpc";

// Sessions that already showed output in this window: a remount (project or tab switch) skips the
// start overlay instead of flashing it until hasContent answers
const sessionsWithData = new Set<string>();

/** An ended session shows as ended once its output was seen or its saved history was read, even
 *  an empty one (a shell keeps none): waiting for either was a spinner with no end */
export const showsEnded = (ended: boolean, output: boolean, historyLoading: boolean) =>
  ended && (output || !historyLoading);

/**
 * Track first-data arrival on a freshly mounted terminal pane. The PTY may
 * already have buffered content from before app restart, so this also probes
 * the ring-buffer snapshot once on mount. Once the agent stops, loads its saved history.
 */
export function useTerminalLifecycle({
  agentId,
  status,
  reconnecting = false,
  startTimeoutMs = 8_000,
}: {
  agentId: string;
  status: string | undefined;
  /** Startup reattach has not reached this session: no output yet is not a failed start */
  reconnecting?: boolean;
  startTimeoutMs?: number;
}) {
  const rawIsStopped = status ? ENDED_STATUSES.has(status) : false;
  const { data: scrollbackContent, isLoading: scrollbackLoading } = useScrollback(
    rawIsStopped ? agentId : null,
  );
  const [hasData, setHasDataState] = useState(() => sessionsWithData.has(agentId));
  const setHasData = useCallback(() => {
    sessionsWithData.add(agentId);
    setHasDataState(true);
  }, [agentId]);
  const [startTimedOut, setStartTimedOut] = useState(false);
  const startTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (rawIsStopped || hasData) return;
    const unsub = window.api.terminal.onData(agentId, () => {
      setHasData();
      unsub();
    });
    window.api.terminal.hasContent(agentId).then((has) => {
      if (has) setHasData();
    });
    return unsub;
  }, [agentId, rawIsStopped, hasData, setHasData]);

  useEffect(() => {
    if (hasData || rawIsStopped || reconnecting) {
      if (startTimerRef.current) {
        window.clearTimeout(startTimerRef.current);
        startTimerRef.current = null;
      }
      return;
    }
    if (startTimerRef.current) return;
    startTimerRef.current = window.setTimeout(() => {
      startTimerRef.current = null;
      setStartTimedOut(true);
    }, startTimeoutMs);
  }, [hasData, rawIsStopped, reconnecting, startTimeoutMs]);

  return {
    hasData,
    startTimedOut,
    isStopped: showsEnded(rawIsStopped, hasData, scrollbackLoading),
    scrollbackContent,
    scrollbackLoading,
  };
}
