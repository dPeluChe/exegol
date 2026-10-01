/** A size the browser shows a page at, like Chrome's device toolbar: the page lays out for that
 *  width (its media queries apply); a pane narrower than it scrolls */
export interface PageSize {
  label: string;
  width: number;
  height: number;
}

export const PRESET_SIZES: PageSize[] = [
  { label: "Desktop", width: 1440, height: 900 },
  { label: "Laptop", width: 1280, height: 800 },
  { label: "Tablet", width: 768, height: 1024 },
  { label: "Mobile", width: 390, height: 844 },
];

const MIN = 200;
const MAX = 5000;

/** "390x844", the form a size travels in (floating window URL, select values) */
export const sizeKey = (s: Pick<PageSize, "width" | "height">) => `${s.width}x${s.height}`;

/** A size from user input or a URL param; null when it is not a sane one */
export function parseSize(text: string, label?: string): PageSize | null {
  const m = text.trim().match(/^(\d{3,4})\s*[x×]\s*(\d{3,4})$/i);
  if (!m) return null;
  const width = Number(m[1]);
  const height = Number(m[2]);
  if (width < MIN || height < MIN || width > MAX || height > MAX) return null;
  return { label: label?.trim() || `${width}×${height}`, width, height };
}

export const isHttpUrl = (url: string) => /^https?:\/\//.test(url);

/** What the user typed in an address bar, as a URL: "localhost:3000" gets http:// */
export function toHttpUrl(input: string): string {
  const url = input.trim();
  return !url || isHttpUrl(url) ? url : `http://${url}`;
}

/** What "Sizes" opens with: the size shown now first, then desktop, tablet and mobile */
export function compareSizes(current: PageSize | undefined): PageSize[] {
  const defaults = PRESET_SIZES.filter((s) => s.label !== "Laptop");
  if (!current) return defaults;
  return [current, ...defaults.filter((s) => sizeKey(s) !== sizeKey(current))];
}
