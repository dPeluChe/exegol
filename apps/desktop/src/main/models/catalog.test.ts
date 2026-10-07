import { describe, expect, it } from "vitest";
import { DEFAULT_MODEL_ID, MODEL_CATALOG, validateCatalog } from "./catalog";

describe("speech model catalog", () => {
  it("is valid as shipped", () => {
    expect(validateCatalog(MODEL_CATALOG)).toEqual([]);
  });

  it("keeps Parakeet v3 as the default, with Spanish", () => {
    const def = MODEL_CATALOG.find((m) => m.id === DEFAULT_MODEL_ID);
    expect(def?.languages).toContain("es");
    expect(def?.license).toBe("CC-BY-4.0");
  });

  it("refuses a bad hash, a path out of the model folder and a duplicate id", () => {
    const base = MODEL_CATALOG[0];
    if (!base) throw new Error("empty catalog");
    const problems = validateCatalog([
      base,
      { ...base, sha256: "abc" },
      { ...base, id: "other", files: ["../../.ssh/id_rsa"] },
    ]);
    expect(problems.some((p) => p.includes("sha256"))).toBe(true);
    expect(problems.some((p) => p.includes("files"))).toBe(true);
    expect(problems.some((p) => p.includes("duplicate"))).toBe(true);
  });

  it("refuses a source URL that does not match the archive folder", () => {
    const base = MODEL_CATALOG[0];
    if (!base) throw new Error("empty catalog");
    const problems = validateCatalog([{ ...base, rootDir: "something-else" }]);
    expect(problems.some((p) => p.includes("sourceUrl"))).toBe(true);
  });
});
