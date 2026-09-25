/**
 * The scraped "current step" of a full-screen TUI (devin, opencode) is often a
 * status bar or box border: `1 shell · ↓ select ⡿⣿ 6"`. Those glyphs render as
 * noise in the sidebar and dashboard, so such a line is dropped and the
 * previous step stays. Glyphs = box drawing, blocks, Braille (spinners) and
 * private-use icon fonts.
 */
const GLYPH = "[\\u2500-\\u259F\\u2800-\\u28FF\\uE000-\\uF8FF\\u{F0000}-\\u{FFFFD}]";
const LEADING = new RegExp(`^(?:${GLYPH}|\\s)+`, "u");
const ANY = new RegExp(GLYPH, "u");

export function readableStep(step: string | undefined): string | undefined {
  if (!step) return undefined;
  // A leading spinner or icon is decoration; glyphs further in mean UI chrome
  const text = step.replace(LEADING, "").replace(/\s+/g, " ").trim();
  if (ANY.test(text)) return undefined;
  return (text.match(/\p{L}/gu)?.length ?? 0) >= 3 ? text : undefined;
}
