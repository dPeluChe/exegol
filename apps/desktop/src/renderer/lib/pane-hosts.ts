/** A pane kept out of the split tree: the tree holds an empty slot for it and its content sits
 *  in a flat layer on top, so a split, a close or a resize beside it never remounts it. A
 *  remounted browser page is a new page: its tab-only state (sessionStorage logins) is gone */
export const HOSTED_PANE_TYPES: ReadonlySet<string> = new Set(["browser"]);

export const SLOT_ATTR = "data-pane-slot";
export const HOST_ATTR = "data-pane-host";

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Where a host goes inside the layer for its slot's place on screen */
export function hostBox(slot: Box, layer: Box): Box {
  return {
    left: slot.left - layer.left,
    top: slot.top - layer.top,
    width: slot.width,
    height: slot.height,
  };
}

/** Put every host of `layer` over its slot. A host with no slot keeps its last place, hidden */
export function placeHosts(layer: HTMLElement): void {
  const frame = layer.getBoundingClientRect();
  // Not laid out (an ancestor is display: none): the hosts keep the size they had
  if (frame.width === 0 || frame.height === 0) return;
  const slots = new Map<string, Element>();
  for (const slot of layer.querySelectorAll(`[${SLOT_ATTR}]`)) {
    slots.set(slot.getAttribute(SLOT_ATTR) ?? "", slot);
  }
  for (const host of layer.querySelectorAll<HTMLElement>(`:scope > [${HOST_ATTR}]`)) {
    const slot = slots.get(host.getAttribute(HOST_ATTR) ?? "");
    if (!slot) {
      host.style.visibility = "hidden";
      continue;
    }
    const box = hostBox(slot.getBoundingClientRect(), frame);
    host.style.visibility = "";
    host.style.left = `${box.left}px`;
    host.style.top = `${box.top}px`;
    host.style.width = `${box.width}px`;
    host.style.height = `${box.height}px`;
  }
}
