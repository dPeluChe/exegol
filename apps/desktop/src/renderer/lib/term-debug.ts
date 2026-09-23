/**
 * T194 terminal diagnostics: sizes, fits, visibility and repaints, per view.
 * Logs only when a key's value changes, so a loop shows up as alternating lines
 * instead of a flood. Goes to main too, landing in ~/.exegol/logs/exegol.log.
 * Dev builds only.
 */
const enabled = import.meta.env.DEV;
const last = new Map<string, string>();

export function termDbg(key: string, event: string, data: Record<string, unknown>): void {
  if (!enabled) return;
  const snapshot = JSON.stringify(data);
  if (last.get(key) === snapshot) return;
  last.set(key, snapshot);
  console.log(`[TermDbg] ${event}`, data);
  window.api.debug?.log(event, data);
}
