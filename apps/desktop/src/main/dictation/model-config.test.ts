import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MODEL_CATALOG } from "../models/catalog";
import { isInside, recognizerKey, recognizerSpec, specPaths } from "./model-config";

const ROOT = "/home/u/.exegol/models";

describe("recognizer specs", () => {
  it("covers every catalog model, with only files the catalog installs", () => {
    for (const entry of MODEL_CATALOG) {
      const dir = join(ROOT, entry.id);
      const spec = recognizerSpec(entry, dir, 2, "en");
      expect(spec, entry.id).not.toBeNull();
      const files = specPaths(spec?.config).map((p) => p.slice(dir.length + 1));
      for (const file of files) {
        const known = entry.files.some((f) => f === file || f.startsWith(`${file}/`));
        expect(known, `${entry.id}: ${file}`).toBe(true);
      }
    }
  });

  it("streams only the streaming models", () => {
    for (const entry of MODEL_CATALOG) {
      const spec = recognizerSpec(entry, join(ROOT, entry.id), 2, "en");
      expect(spec?.kind, entry.id).toBe(entry.kind === "streaming" ? "online" : "offline");
    }
  });

  it("runs Canary in the setting's language, without translation", () => {
    const entry = MODEL_CATALOG.find((m) => m.id === "canary-180m-flash-int8");
    if (!entry) throw new Error("no canary");
    const dir = join(ROOT, entry.id);
    for (const language of ["en", "es"] as const) {
      const spec = recognizerSpec(entry, dir, 2, language);
      expect(spec?.kind).toBe("offline");
      expect(spec?.config.featConfig.featureDim).toBe(128);
      expect(spec?.config.modelConfig.canary).toEqual({
        encoder: join(dir, "encoder.int8.onnx"),
        decoder: join(dir, "decoder.int8.onnx"),
        srcLang: language,
        tgtLang: language,
        usePnc: 1,
      });
    }
  });

  it("leaves models that detect the language unchanged by the setting", () => {
    for (const entry of MODEL_CATALOG.filter((m) => m.id !== "canary-180m-flash-int8")) {
      const dir = join(ROOT, entry.id);
      expect(recognizerSpec(entry, dir, 2, "es"), entry.id).toEqual(
        recognizerSpec(entry, dir, 2, "en"),
      );
    }
  });

  it("caches by language only for models that need one", () => {
    expect(recognizerKey("canary-180m-flash-int8", "en")).toBe("canary-180m-flash-int8:en");
    expect(recognizerKey("canary-180m-flash-int8", "es")).toBe("canary-180m-flash-int8:es");
    expect(recognizerKey("parakeet-tdt-0.6b-v3-int8", "es")).toBe("parakeet-tdt-0.6b-v3-int8");
    expect(recognizerKey("whisper-large-v3-turbo-int8", "en")).toBe(
      recognizerKey("whisper-large-v3-turbo-int8", "es"),
    );
  });

  it("keeps paths inside the models folder", () => {
    expect(isInside(ROOT, `${ROOT}/parakeet/tokens.txt`)).toBe(true);
    expect(isInside(ROOT, `${ROOT}/../.ssh/id_rsa`)).toBe(false);
    expect(isInside(ROOT, "/etc/passwd")).toBe(false);
    expect(isInside(ROOT, ROOT)).toBe(false);
  });
});
