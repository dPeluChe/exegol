import { expect, it } from "vitest";
import { isReadingAloud, noteReading } from "./reading";

it("holds while any window reads, and forgets a window silent for 10 minutes", () => {
  noteReading(1, true, 0);
  noteReading(2, true, 1000);
  noteReading(1, false);
  expect(isReadingAloud(2000)).toBe(true);
  noteReading(2, false);
  expect(isReadingAloud(2000)).toBe(false);
  noteReading(3, true, 0);
  expect(isReadingAloud(10 * 60_000)).toBe(false);
});
