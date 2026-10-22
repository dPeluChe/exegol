import type { MountStats, WebglCounts } from "@exegol/shared";
import { webglCounts } from "../components/terminal/webgl-counts";

/** Past this the summary goes out with what is still pending */
export const SWITCH_CAP_MS = 3_000;
/** No terminal mounted this soon after the switch: the project shows none */
export const SWITCH_IDLE_MS = 1_000;

export type SwitchReport = Extract<MountStats, { kind: "switch" }>;

export interface SnapshotLanded {
  bytes: number;
  /** Written at a grid other than the snapshot's: the normal buffer reflows */
  reflow: boolean;
}

interface SwitchDeps {
  now: () => number;
  schedule: (fn: () => void, ms: number) => () => void;
  send: (projectId: string, report: SwitchReport) => void;
  webglCounts: () => WebglCounts;
}

/** What one project switch costs: terminals mounted per tab kind until each applied its snapshot */
export function createSwitchTracker({ now, schedule, send, webglCounts }: SwitchDeps) {
  let open: {
    projectId: string;
    startedAt: number;
    kept: number;
    active: number;
    hidden: number;
    pending: number;
    bytes: number;
    reflows: number;
    lastAt: number;
    webglAtStart: WebglCounts;
    cancelTimers: () => void;
  } | null = null;

  const finish = (ended: SwitchReport["ended"]) => {
    const s = open;
    if (!s) return;
    open = null;
    s.cancelTimers();
    const end = ended === "settled" ? s.lastAt : now();
    const gl = webglCounts();
    const at = s.webglAtStart;
    send(s.projectId, {
      kind: "switch",
      keptMounts: s.kept,
      activeMounts: s.active,
      hiddenMounts: s.hidden,
      afterMs: end - s.startedAt,
      snapshotBytes: s.bytes,
      reflows: s.reflows,
      pending: s.pending,
      ended,
      webgl: {
        reused: gl.reused - at.reused,
        attached: gl.attached - at.attached,
        evicted: gl.evicted - at.evicted,
      },
    });
  };

  return {
    /** null: no project shown; a switch still open is reported as cut short. `kept`: terminals
     *  the project already had mounted (kept mounted while hidden), none of them rebuilt */
    start(projectId: string | null, kept = 0): void {
      finish("switched");
      if (!projectId) return;
      const startedAt = now();
      const stopCap = schedule(() => finish("timeout"), SWITCH_CAP_MS);
      const stopIdle = schedule(() => {
        if (open && open.active + open.hidden === 0) finish("settled");
      }, SWITCH_IDLE_MS);
      open = {
        projectId,
        startedAt,
        kept,
        active: 0,
        hidden: 0,
        pending: 0,
        bytes: 0,
        reflows: 0,
        lastAt: startedAt,
        webglAtStart: webglCounts(),
        cancelTimers: () => {
          stopCap();
          stopIdle();
        },
      };
    },

    /** A view mounted; call the returned function once its snapshot landed (null: it unmounted first) */
    mounted(activeTab: boolean): ((landed: SnapshotLanded | null) => void) | null {
      const s = open;
      if (!s) return null;
      if (activeTab) s.active++;
      else s.hidden++;
      s.pending++;
      let done = false;
      return (landed) => {
        if (done || open !== s) return;
        done = true;
        s.pending--;
        if (landed) {
          s.bytes += landed.bytes;
          if (landed.reflow) s.reflows++;
          s.lastAt = now();
        }
        if (s.pending === 0) finish("settled");
      };
    },
  };
}

const tracker = createSwitchTracker({
  now: () => performance.now(),
  schedule: (fn, ms) => {
    const timer = setTimeout(fn, ms);
    return () => clearTimeout(timer);
  },
  // Runs inside the store subscriber: a missing bridge (store tests) must not break the switch
  send: (projectId, report) => {
    if (typeof window !== "undefined") window.api?.terminal?.mountLog?.(projectId, report);
  },
  webglCounts,
});

export const projectSwitchStarted = tracker.start;
export const noteSwitchMount = tracker.mounted;
