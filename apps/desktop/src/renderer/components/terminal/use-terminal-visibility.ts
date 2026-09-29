import { type RefObject, useEffect, useId, useRef, useState } from "react";

/** Long enough that scrolling past a pane costs nothing; short enough that a
 *  backgrounded agent stops paying IPC almost immediately. */
export const HIDE_DEBOUNCE_MS = 1_500;

/** T38: whether the terminal's box is on screen; reported to main (T178) */
export function useTerminalVisibility(
  containerRef: RefObject<HTMLDivElement | null>,
  agentId: string,
): boolean {
  const [isVisible, setIsVisible] = useState(true);
  const viewId = useId();
  const reportedVisibleRef = useRef(false);

  // Visibility observer: the caller drives WebGL attach/detach + the T115 dormant ring from it
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry) setIsVisible(entry.isIntersecting);
      },
      { threshold: 0.01 },
    );
    observer.observe(container);
    return () => observer.disconnect();
  }, [containerRef]);

  // T178: tell main whether this view can draw, so it stops shipping bytes
  // across IPC to a pane nobody is looking at. When output was dropped while
  // hidden, main answers with a snapshot and we repaint from it — resuming
  // mid-stream would paint onto a screen the app has already moved past.
  useEffect(() => {
    // Revealing costs a full serialize in main, so a pane flicking past during
    // a scroll must not pay for it. Hiding is debounced; showing is immediate,
    // because a late reveal is a visibly stale terminal.
    // viewId: main counts views, not windows, so a pane unmounting can't
    // silence its Dashboard mirror in the same window (T194)
    if (!isVisible) {
      const timer = setTimeout(() => {
        window.api.terminal.setVisible(agentId, false, viewId).catch(() => {});
      }, HIDE_DEBOUNCE_MS);
      return () => clearTimeout(timer);
    }
    // The repaint arrives on terminal:data, in order with live output — this
    // call only reports. Acquire/release: unmounting while visible must release
    // too, or the view stays registered and the gate never engages again.
    // First report of this view: its mount already fetched a snapshot
    const fresh = !reportedVisibleRef.current;
    reportedVisibleRef.current = true;
    window.api.terminal.setVisible(agentId, true, viewId, fresh).catch(() => {});
    return () => {
      window.api.terminal.setVisible(agentId, false, viewId).catch(() => {});
    };
  }, [agentId, isVisible, viewId]);

  return isVisible;
}
