/** Sessions the idle sweep leaves alone (Watching pins, unread attention items): only the
 *  renderer knows them. Until it has reported once after startup, nothing is swept */
let exempt: ReadonlySet<string> = new Set();
let reported = false;

export function setIdleExempt(ids: string[]): void {
  exempt = new Set(ids);
  reported = true;
}

export const idleExempt = (): ReadonlySet<string> => exempt;
export const idleExemptReported = (): boolean => reported;
