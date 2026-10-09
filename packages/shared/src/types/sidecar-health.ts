/** The PTY sidecar's health as main sees it, pushed on `sidecar:health` */
export interface SidecarHealth {
  /** Pings to the sidecar stopped answering */
  stalled: boolean;
  /** Epoch ms the stall began (oldest unanswered call), null while healthy */
  since: number | null;
}

export const SIDECAR_HEALTHY: SidecarHealth = { stalled: false, since: null };
