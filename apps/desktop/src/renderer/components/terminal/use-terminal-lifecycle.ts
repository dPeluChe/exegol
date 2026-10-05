import { useEffect, useRef, useState } from "react";
import { useScrollback } from "../../hooks/use-trpc";

const STOPPED_STATUSES = new Set(["completed", "failed", "stopped", "crashed"]);

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
  const rawIsStopped = status ? STOPPED_STATUSES.has(status) : false;
  const { data: scrollbackContent, isLoading: scrollbackLoading } = useScrollback(
    rawIsStopped ? agentId : null,
  );
  const [hasData, setHasData] = useState(false);
  const [startTimedOut, setStartTimedOut] = useState(false);
  const startTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (rawIsStopped || hasData) return;
    const unsub = window.api.terminal.onData(agentId, () => {
      setHasData(true);
      unsub();
    });
    window.api.terminal.hasContent(agentId).then((has) => {
      if (has) setHasData(true);
    });
    return unsub;
  }, [agentId, rawIsStopped, hasData]);

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
    // Don't show "Ended" UI until we've received at least one data chunk,
    // OR until scrollback is available in DB (reattach/reload scenario)
    isStopped: rawIsStopped && (hasData || !!scrollbackContent),
    scrollbackContent,
    scrollbackLoading,
  };
}
