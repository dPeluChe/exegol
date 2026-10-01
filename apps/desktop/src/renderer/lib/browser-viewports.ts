/** Sizes the browser pane can show a page at, like Chrome's device toolbar: the page lays out for
 *  that width (its media queries apply); a pane narrower than it scrolls */
export const VIEWPORTS = [
  { id: "fit", label: "Fit pane" },
  { id: "desktop", label: "Desktop 1440", width: 1440, height: 900 },
  { id: "laptop", label: "Laptop 1280", width: 1280, height: 800 },
  { id: "tablet", label: "Tablet 768", width: 768, height: 1024 },
  { id: "mobile", label: "Mobile 390", width: 390, height: 844 },
] as const;

export type ViewportId = (typeof VIEWPORTS)[number]["id"];

export function viewportSize(id: ViewportId | undefined): { width: number; height: number } | null {
  const v = VIEWPORTS.find((x) => x.id === id);
  return v && "width" in v ? { width: v.width, height: v.height } : null;
}
