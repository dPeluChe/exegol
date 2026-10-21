import { describe, expect, it } from "vitest";
import { folderName } from "./add-project";

describe("folderName", () => {
  it("takes the last segment on both separators", () => {
    expect(folderName("/a/b/app/")).toBe("app");
    expect(folderName("C:\\code\\app")).toBe("app");
  });
});
