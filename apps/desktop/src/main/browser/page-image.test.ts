import { describe, expect, it } from "vitest";
import { flattenOnWhite } from "./page-image";

describe("screenshots of a page with no background", () => {
  it("turns transparent pixels white and leaves opaque ones alone", () => {
    const bitmap = Buffer.from([0, 0, 0, 0, 10, 20, 30, 255, 40, 40, 40, 128]);
    expect(flattenOnWhite(bitmap)).toBe(true);
    expect([...bitmap]).toEqual([255, 255, 255, 255, 10, 20, 30, 255, 167, 167, 167, 255]);
  });

  it("says when there was nothing to do, so the image can go out as it is", () => {
    expect(flattenOnWhite(Buffer.from([10, 20, 30, 255]))).toBe(false);
  });
});
