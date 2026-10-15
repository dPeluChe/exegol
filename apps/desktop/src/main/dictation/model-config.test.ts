import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MODEL_CATALOG } from "../models/catalog";
import {
  bpeVocabFromTokens,
  isInside,
  recognizerKey,
  recognizerSpec,
  specPaths,
  vocabularyHash,
  vocabularyUse,
} from "./model-config";

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

describe("vocabulary", () => {
  const vocab = {
    terms: ["worktree", "pull request"],
    score: 3,
    hash: vocabularyHash(["worktree", "pull request"], 3),
    bpeVocab: "/home/u/.exegol/dictation-vocab/p.bpe.vocab",
  };
  const spec = (id: string, v: typeof vocab | null = vocab) => {
    const entry = MODEL_CATALOG.find((m) => m.id === id);
    if (!entry) throw new Error(id);
    return recognizerSpec(entry, join(ROOT, id), 2, "en", v)?.config;
  };

  it("Parakeet gets hotwords per stream with modified_beam_search and the bpe vocab", () => {
    expect(spec("parakeet-tdt-0.6b-v3-int8")).toMatchObject({
      decodingMethod: "modified_beam_search",
      hotwordsScore: 3,
      modelConfig: { modelingUnit: "bpe", bpeVocab: vocab.bpeVocab },
    });
    expect(spec("parakeet-tdt-0.6b-v3-int8")?.hotwordsFile).toBeUndefined();
    const entry = MODEL_CATALOG.find((m) => m.id === "parakeet-tdt-0.6b-v3-int8");
    if (!entry) throw new Error("parakeet");
    expect(recognizerSpec(entry, ROOT, 2, "en", vocab)?.hotwords).toBe("worktree/pull request");
    expect(recognizerSpec(entry, ROOT, 2, "en")?.hotwords).toBeUndefined();
  });

  it("without terms Parakeet stays on greedy search", () => {
    for (const v of [null, { ...vocab, terms: [] }]) {
      const config = spec("parakeet-tdt-0.6b-v3-int8", v);
      expect(config?.decodingMethod).toBeUndefined();
      expect(config?.modelConfig.bpeVocab).toBeUndefined();
    }
  });

  it("Qwen3-ASR takes them in its prompt", () => {
    expect(spec("qwen3-asr-0.6b-int8")?.modelConfig).toMatchObject({
      qwen3Asr: { hotwords: "worktree,pull request" },
    });
  });

  it("models without biasing ignore it", () => {
    for (const entry of MODEL_CATALOG.filter((m) => !vocabularyUse(m.id))) {
      const config = recognizerSpec(entry, join(ROOT, entry.id), 2, "en", vocab)?.config;
      expect(JSON.stringify(config), entry.id).not.toContain("worktree");
      expect(recognizerSpec(entry, ROOT, 2, "en", vocab)?.hotwords, entry.id).toBeUndefined();
    }
  });

  it("caches by vocabulary only for models that use one, with the language for Canary", () => {
    const parakeet = "parakeet-tdt-0.6b-v3-int8";
    expect(recognizerKey(parakeet, "es", vocab)).toBe(`${parakeet}#beam3`);
    // Hotwords go per stream: other terms (another project) keep the loaded recognizer
    const other = { ...vocab, terms: ["Biome"], hash: vocabularyHash(["Biome"], 3) };
    expect(recognizerKey(parakeet, "en", other)).toBe(recognizerKey(parakeet, "en", vocab));
    expect(recognizerKey(parakeet, "en", { ...vocab, score: 2 })).not.toBe(
      recognizerKey(parakeet, "en", vocab),
    );
    // Qwen takes them in its prompt: new terms are a new recognizer
    expect(recognizerKey("qwen3-asr-0.6b-int8", "en", vocab)).toBe(
      `qwen3-asr-0.6b-int8#${vocab.hash}`,
    );
    expect(recognizerKey("qwen3-asr-0.6b-int8", "en", other)).not.toBe(
      recognizerKey("qwen3-asr-0.6b-int8", "en", vocab),
    );
    expect(recognizerKey("parakeet-tdt-0.6b-v3-int8", "en", { ...vocab, terms: [] })).toBe(
      "parakeet-tdt-0.6b-v3-int8",
    );
    expect(recognizerKey("canary-180m-flash-int8", "es", vocab)).toBe("canary-180m-flash-int8:es");
    expect(recognizerKey("whisper-large-v3-turbo-int8", "en", vocab)).toBe(
      "whisper-large-v3-turbo-int8",
    );
  });

  it("tokens.txt becomes a sentencepiece vocab without the special tokens", () => {
    expect(bpeVocabFromTokens("<unk> 0\n<pad> 1\n▁the 2\ns 3\n<blk> 4\n")).toBe(
      "▁the\t-2\ns\t-3\n",
    );
  });
});
