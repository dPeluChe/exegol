import type { SpeechModelEntry } from "@exegol/shared";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { DEFAULT_MODEL_ID, MODEL_CATALOG } from "./catalog";

const relativeFile = z
  .string()
  .min(1)
  .refine((p) => !p.startsWith("/") && !p.split("/").includes(".."), "must stay inside rootDir");

const entrySchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9.-]*$/),
  name: z.string().min(1),
  engine: z.literal("sherpa-onnx"),
  engineAvailable: z.boolean(),
  kind: z.enum(["offline", "streaming"]),
  languages: z.array(z.string().regex(/^[a-z]{2,3}$/)),
  languageSummary: z.string().optional(),
  bestFor: z.string().min(1),
  sizeBytes: z.number().int().positive(),
  installedBytes: z.number().int().positive(),
  license: z.string().min(1),
  attribution: z.string().min(1),
  sourceUrl: z.string().url().startsWith("https://"),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  archive: z.literal("tar.bz2"),
  rootDir: z.string().regex(/^[A-Za-z0-9._-]+$/),
  files: z.array(relativeFile).min(1),
  commercialUse: z.boolean().optional(),
  notes: z.string().optional(),
  featured: z.number().int().positive().optional(),
});

function validateCatalog(entries: readonly SpeechModelEntry[]): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const entry of entries) {
    const parsed = entrySchema.safeParse(entry);
    if (!parsed.success) {
      problems.push(`${entry.id}: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`);
    }
    if (ids.has(entry.id)) problems.push(`${entry.id}: duplicate id`);
    ids.add(entry.id);
    if (entry.languages.length === 0 && !entry.languageSummary) {
      problems.push(`${entry.id}: no languages`);
    }
    if (entry.featured !== undefined && entry.commercialUse === false) {
      problems.push(`${entry.id}: a non-commercial model in the recommended list`);
    }
    if (!entry.sourceUrl.endsWith(`/${entry.rootDir}.tar.bz2`)) {
      problems.push(`${entry.id}: sourceUrl does not match rootDir`);
    }
  }
  const def = entries.find((e) => e.id === DEFAULT_MODEL_ID);
  if (!def) problems.push("default model missing");
  if (def?.commercialUse === false) problems.push("default model is non-commercial");
  return problems;
}

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

  it("recommends Parakeet first and never a non-commercial model", () => {
    const featured = MODEL_CATALOG.filter((m) => m.featured !== undefined).sort(
      (a, b) => (a.featured ?? 0) - (b.featured ?? 0),
    );
    expect(featured[0]?.id).toBe(DEFAULT_MODEL_ID);
    const base = MODEL_CATALOG.find((m) => m.commercialUse === false);
    if (!base) throw new Error("no non-commercial model");
    expect(validateCatalog([{ ...base, featured: 4 }]).join()).toContain("recommended list");
  });

  it("never makes a non-commercial model the default", () => {
    const base = MODEL_CATALOG.find((m) => m.id === DEFAULT_MODEL_ID);
    if (!base) throw new Error("no default");
    expect(validateCatalog([{ ...base, commercialUse: false }])).toContain(
      "default model is non-commercial",
    );
    expect(MODEL_CATALOG.find((m) => m.id === "moonshine-v2-base-es")?.commercialUse).toBe(false);
  });
});
