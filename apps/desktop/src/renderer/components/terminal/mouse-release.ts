/** xterm adds document mouseup/mousemove listeners on a press and drops them on the release. A
 *  terminal disposed mid-press keeps them, and each later click anywhere throws reading
 *  `dimensions`. Tracks the press so teardown can deliver the release xterm is waiting for */
export function trackMousePress(
  element: EventTarget,
  doc: EventTarget = document,
  makeRelease: () => Event = () => new MouseEvent("mouseup", { button: 0, buttons: 0 }),
): { release: () => void } {
  let pressed = false;
  const onDown = () => {
    pressed = true;
  };
  const onUp = () => {
    pressed = false;
  };
  element.addEventListener("mousedown", onDown, true);
  doc.addEventListener("mouseup", onUp, true);
  return {
    release: () => {
      element.removeEventListener("mousedown", onDown, true);
      doc.removeEventListener("mouseup", onUp, true);
      // Only while our press is open: a synthetic mouseup would end someone else's drag
      if (pressed) doc.dispatchEvent(makeRelease());
      pressed = false;
    },
  };
}
