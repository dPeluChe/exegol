/** The tab a key moves to in a tablist (wraps), or null for any other key */
export function tabKeyTarget(key: string, index: number, count: number): number | null {
  if (count === 0) return null;
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return (index + 1) % count;
    case "ArrowLeft":
    case "ArrowUp":
      return (index - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}
