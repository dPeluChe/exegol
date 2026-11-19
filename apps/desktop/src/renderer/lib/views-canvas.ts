import { VIEW_PAGE, type ViewEntry } from "@exegol/shared";

export const CARD_WIDTH = 240;
export const CARD_LABEL_HEIGHT = 52;
export const ZOOM_MIN = 0.1;
// A card is a quarter of its thumbnail's width: 4 shows the thumbnail at its own size
export const ZOOM_MAX = 4;

export interface Camera {
  x: number;
  y: number;
  k: number;
}

/** A card's height: its thumbnail at the card's width (one screen until it is captured) plus
 *  the label, so the tree is laid out with the real sizes */
export function cardHeight(view: ViewEntry | undefined): number {
  const ratio =
    view?.width && view.height ? view.height / view.width : VIEW_PAGE.height / VIEW_PAGE.width;
  return Math.round(CARD_WIDTH * ratio) + CARD_LABEL_HEIGHT;
}

const clampZoom = (k: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, k));

/** Zoom by `factor` keeping the canvas point under (px, py) of the viewport where it is */
export function zoomAt(cam: Camera, px: number, py: number, factor: number): Camera {
  const k = clampZoom(cam.k * factor);
  const scale = k / cam.k;
  return { k, x: px - (px - cam.x) * scale, y: py - (py - cam.y) * scale };
}

/** The whole tree in view, centered, never enlarged past 100% */
export function fitCamera(
  content: { width: number; height: number },
  viewport: { width: number; height: number },
  margin = 32,
): Camera {
  if (content.width <= 0 || content.height <= 0) return { x: margin, y: margin, k: 1 };
  const k = clampZoom(
    Math.min(
      1,
      (viewport.width - margin * 2) / content.width,
      (viewport.height - margin * 2) / content.height,
    ),
  );
  return {
    k,
    x: (viewport.width - content.width * k) / 2,
    y: Math.max(margin, (viewport.height - content.height * k) / 2),
  };
}

/** A curve between two cards for a link of the selected view, as SVG path data */
export function linkCurve(
  from: { x: number; y: number; width: number; height: number },
  to: { x: number; y: number; width: number; height: number },
): string {
  const x1 = from.x + from.width / 2;
  const y1 = from.y + from.height / 2;
  const x2 = to.x + to.width / 2;
  const y2 = to.y + to.height / 2;
  const bend = Math.max(40, Math.abs(x2 - x1) * 0.25);
  return `M${x1} ${y1}C${x1} ${y1 - bend} ${x2} ${y2 - bend} ${x2} ${y2}`;
}

/** Views that link to `path`, for the details of a selected view */
export function linkedFrom(views: readonly ViewEntry[], path: string): string[] {
  return views
    .filter((v) => v.path !== path && v.links?.some((l) => l.to === path))
    .map((v) => v.path);
}
