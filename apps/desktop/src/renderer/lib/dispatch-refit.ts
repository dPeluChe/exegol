/** Notify all terminal instances to recalculate dimensions after a layout change. */
export function dispatchRefitTerminals(): void {
  requestAnimationFrame(() => {
    window.dispatchEvent(new Event("exegol:refit-terminals"));
  });
}
