import { findFileMatches, type LinkMatch } from "./terminal-links";

export interface LinkRow {
  text: string;
  /** xterm's own soft wrap; a TUI breaks a line with real newlines, so this stays false there */
  wrapped: boolean;
}

const MAX_ROWS = 8;
/** A TUI wraps inside its padding, short of the last column */
const NEAR_EDGE = 12;
const PATH_TAIL = /(?:^|\s)\S*[\\/]\S*$/;
const PATH_HEAD = /^\s*[\p{L}\p{N}_.@~+\\/-]/u;

function continues(prev: LinkRow, next: LinkRow, cols: number): boolean {
  if (next.wrapped) return true;
  const end = prev.text.trimEnd();
  return end.length >= cols - NEAR_EDGE && PATH_TAIL.test(end) && PATH_HEAD.test(next.text);
}

/**
 * Paths that run over the edge of row `y` into its neighbours. A guess by shape: nothing becomes
 * a link until main confirms the joined path exists.
 */
export function wrappedFileMatches(
  y: number,
  rowAt: (y: number) => LinkRow | null,
  cols: number,
): LinkMatch[] {
  const joins = (row: number) => {
    const prev = rowAt(row - 1);
    const here = rowAt(row);
    return !!prev && !!here && continues(prev, here, cols);
  };
  let first = y;
  while (y - first < MAX_ROWS - 1 && joins(first)) first--;
  const spans: Array<{ y: number; at: number; col: number }> = [];
  let joined = "";
  for (let row = first; row - first < MAX_ROWS && (row === first || joins(row)); row++) {
    const here = rowAt(row);
    if (!here) break;
    const col = here.wrapped || row === first ? 0 : here.text.length - here.text.trimStart().length;
    spans.push({ y: row, at: joined.length, col });
    joined += here.text.slice(col);
  }
  if (spans.length < 2) return [];
  const cell = (index: number) => {
    const span = spans.findLast((s) => s.at <= index) as (typeof spans)[number];
    return { x: span.col + index - span.at + 1, y: span.y };
  };
  return findFileMatches(joined).flatMap((m) => {
    const start = cell(m.index);
    const end = cell(m.index + m.length - 1);
    const crosses = start.y !== end.y && start.y <= y && y <= end.y;
    return crosses ? [{ ...m, range: { start, end } }] : [];
  });
}

/** The 0-based columns a match takes on row `y`, end excluded */
function columnsOn(m: LinkMatch, y: number): [number, number] {
  if (!m.range) return [m.index, m.index + m.length];
  const { start, end } = m.range;
  return [y === start.y ? start.x - 1 : 0, y === end.y ? end.x : Number.POSITIVE_INFINITY];
}

/** `y` is a row the match touches: `wrappedFileMatches` only returns those */
export function inCell(m: LinkMatch, col: number, y: number): boolean {
  const [from, to] = columnsOn(m, y);
  return col >= from && col < to;
}

/** A piece of a wrapped path can be a real folder by itself: the whole path wins */
export function dropCovered(matches: LinkMatch[], y: number): LinkMatch[] {
  const claimed = matches.filter((m) => m.range).map((m) => columnsOn(m, y));
  return matches.filter(
    (m) => m.range || !claimed.some(([from, to]) => m.index < to && m.index + m.length > from),
  );
}
