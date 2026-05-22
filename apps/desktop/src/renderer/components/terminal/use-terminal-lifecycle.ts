import { useCallback, useEffect, useRef, useState } from "react";

interface UseTerminalLifecycleArgs {
  agentId: string;
  isStopped: boolean;
  startTimeoutMs?: number;
}

interface TerminalLifecycle {
  hasData: boolean;
  hasEverHadData: boolean;
  startTimedOut: boolean;
  markData: () => void;
}

/**
 * Track first-data arrival on a freshly mounted terminal pane. The PTY may
 * already have buffered content from before app restart, so this also probes
 * the ring-buffer snapshot once on mount.
 */
export function useTerminalLifecycle({
  agentId,
  isStopped,
  startTimeoutMs = 8_000,
}: UseTerminalLifecycleArgs): TerminalLifecycle {
  const [hasData, setHasData] = useState(false);
  const hasEverHadDataRef = useRef(false);
  if (hasData) hasEverHadDataRef.current = true;
  const [startTimedOut, setStartTimedOut] = useState(false);
  const startTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (isStopped || hasData) return;
    const unsub = window.api.terminal.onData(agentId, () => {
      setHasData(true);
      unsub();
    });
    window.api.terminal.getSnapshot(agentId).then((snapshot) => {
      if (snapshot && snapshot.length > 0) setHasData(true);
    });
    return unsub;
  }, [agentId, isStopped, hasData]);

  useEffect(() => {
    if (hasData || isStopped) {
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
  }, [hasData, isStopped, startTimeoutMs]);

  const markData = useCallback(() => setHasData(true), []);

  return {
    hasData,
    hasEverHadData: hasEverHadDataRef.current,
    startTimedOut,
    markData,
  };
}
