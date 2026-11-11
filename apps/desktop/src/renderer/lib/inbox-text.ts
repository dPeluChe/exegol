/** A captured page or a pasted note breaks its lines with one newline, which Markdown joins:
 *  each becomes a hard break. Fenced code keeps its lines as they are */
export function keepLineBreaks(text: string): string {
  let fenced = false;
  return text
    .split("\n")
    .map((line, i, lines) => {
      if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
      const next = lines[i + 1];
      const plain = !fenced && line.trim() !== "" && next !== undefined && next.trim() !== "";
      return plain ? `${line.trimEnd()}  ` : line;
    })
    .join("\n");
}

/** Past this a message opens in a box of its own, scrolled and resizable */
export const isLongMessage = (text: string): boolean =>
  text.length > 900 || text.split("\n").length > 14;
