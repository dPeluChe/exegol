import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MODEL_CATALOG } from "../models/catalog";
import {
  bpeVocabFromTokens,
  isInside,
  recognizerSpec,
  specPaths,
  vocabularyUse,
} from "./model-config";

const ROOT = "/home/u/.exegol/models";

describe("recognizer specs", () => {
  it("covers every catalog model, with only files the catalog installs", () => {
    for (const entry of MODEL_CATALOG) {
      const dir = join(ROOT, entry.id);
      const spec = recognizerSpec(entry, dir, 2);
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
      const spec = recognizerSpec(entry, join(ROOT, entry.id), 2);
      expect(spec?.kind, entry.id).toBe(entry.kind === "streaming" ? "online" : "offline");
    }
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
    hotwordsFile: "/home/u/.exegol/dictation-vocab/hotwords.txt",
    bpeVocab: "/home/u/.exegol/dictation-vocab/p.bpe.vocab",
  };
  const spec = (id: string, v: typeof vocab | null = vocab) => {
    const entry = MODEL_CATALOG.find((m) => m.id === id);
    if (!entry) throw new Error(id);
    return recognizerSpec(entry, join(ROOT, id), 2, v)?.config;
  };

  it("Parakeet gets hotwords with modified_beam_search and the bpe vocab", () => {
    expect(spec("parakeet-tdt-0.6b-v3-int8")).toMatchObject({
      decodingMethod: "modified_beam_search",
      hotwordsFile: vocab.hotwordsFile,
      hotwordsScore: 3,
      modelConfig: { modelingUnit: "bpe", bpeVocab: vocab.bpeVocab },
    });
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
      const config = recognizerSpec(entry, join(ROOT, entry.id), 2, vocab)?.config;
      expect(JSON.stringify(config), entry.id).not.toContain("worktree");
      expect(config?.hotwordsFile, entry.id).toBeUndefined();
    }
  });

  it("tokens.txt becomes a sentencepiece vocab without the special tokens", () => {
    expect(bpeVocabFromTokens("<unk> 0\n<pad> 1\n▁the 2\ns 3\n<blk> 4\n")).toBe(
      "▁the\t-2\ns\t-3\n",
    );
  });
});
