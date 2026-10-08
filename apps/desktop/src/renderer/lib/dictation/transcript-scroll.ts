export interface ScrollBox {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

/** Within a few px of the end still counts as the end: subpixel line heights never land on 0 */
const SLACK_PX = 12;

/** The transcript keeps the newest words in view only while the user has not scrolled up */
export const shouldFollow = (box: ScrollBox, slack = SLACK_PX): boolean =>
  box.scrollHeight - box.scrollTop - box.clientHeight <= slack;

export const clippedAbove = (box: ScrollBox): boolean => box.scrollTop > 1;

export function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}
