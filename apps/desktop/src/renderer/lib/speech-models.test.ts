import type { LocalBenchModel, LocalBenchRun, ModelListItem, ModelStatus } from "@exegol/shared";
import { describe, expect, it } from "vitest";
import {
  chooserOptions,
  etaSeconds,
  formatEta,
  groupModels,
  initialChoice,
  languagesLabel,
  lowDisk,
  needsAttribution,
  rankModels,
} from "./speech-models";

const NOT_DOWNLOADED: ModelStatus = { state: "not_downloaded", partialBytes: 0 };

function model(id: string, extra: Partial<ModelListItem> = {}): ModelListItem {
  return {
    id,
    name: id,
    engine: "sherpa-onnx",
    engineAvailable: true,
    kind: "offline",
    languages: ["en", "es"],
    bestFor: "",
    sizeBytes: 100,
    installedBytes: 200,
    license: "MIT",
    attribution: "",
    sourceUrl: "https://example.com/a.tar.bz2",
    sha256: "",
    archive: "tar.bz2",
    rootDir: id,
    files: [],
    status: NOT_DOWNLOADED,
    isDefault: false,
    ...extra,
  };
}

describe("chooserOptions", () => {
  it("keeps the featured models in their order, never a non-commercial or unavailable one", () => {
    const list = [
      model("plain"),
      model("third", { featured: 3 }),
      model("first", { featured: 1 }),
      model("nc", { featured: 2, commercialUse: false }),
      model("coming", { featured: 4, engineAvailable: false }),
    ];
    expect(chooserOptions(list).map((m) => m.id)).toEqual(["first", "third"]);
  });
});

describe("initialChoice", () => {
  const a = model("a", { featured: 1 });
  const b = model("b", { featured: 2 });

  it("preselects the recommended (first) option", () => {
    expect(initialChoice([a, b])).toBe("a");
  });

  it("prefers a model already downloaded, then one downloading", () => {
    const ready = { ...b, status: { state: "ready", diskBytes: 1 } as ModelStatus };
    expect(initialChoice([a, ready])).toBe("b");
    const busy = {
      ...b,
      status: { state: "downloading", receivedBytes: 1, totalBytes: 2 } as ModelStatus,
    };
    expect(initialChoice([a, busy])).toBe("b");
  });

  it("is null with nothing to offer", () => {
    expect(initialChoice([])).toBeNull();
  });
});

describe("model facts", () => {
  it("summarizes languages", () => {
    expect(languagesLabel({ languages: ["en"], languageSummary: undefined })).toBe("EN");
    expect(languagesLabel({ languages: ["a", "b", "c", "d"] })).toBe("4 languages");
    expect(languagesLabel({ languages: [], languageSummary: "99 languages" })).toBe("99 languages");
  });

  it("asks for credit on CC-BY only", () => {
    expect(needsAttribution("CC-BY-4.0")).toBe(true);
    expect(needsAttribution("MIT")).toBe(false);
  });

  it("warns under twice the model size, not when free space is unknown", () => {
    expect(lowDisk(150, 100)).toBe(true);
    expect(lowDisk(250, 100)).toBe(false);
    expect(lowDisk(null, 100)).toBe(false);
  });

  it("estimates the time left once there is a rate", () => {
    expect(etaSeconds({ at: 0, bytes: 0 }, { at: 1000, bytes: 10 }, 100)).toBeNull();
    expect(etaSeconds({ at: 0, bytes: 0 }, { at: 4000, bytes: 40 }, 100)).toBe(6);
    expect(etaSeconds({ at: 0, bytes: 50 }, { at: 4000, bytes: 50 }, 100)).toBeNull();
    expect(formatEta(42)).toBe("42s left");
    expect(formatEta(150)).toBe("3 min left");
  });
});

describe("groupModels", () => {
  it("puts the default, then ready, then downloading models in Installed; the rest stay available", () => {
    const ready: ModelStatus = { state: "ready", diskBytes: 1 };
    const list = [
      model("busy", { status: { state: "downloading", receivedBytes: 1, totalBytes: 2 } }),
      model("ready", { status: ready }),
      model("free"),
      model("default", { status: ready, isDefault: true }),
      model("failed", { status: { state: "failed", error: "x", partialBytes: 0 } }),
    ];
    const { installed, available } = groupModels(list);
    expect(installed.map((m) => m.id)).toEqual(["default", "ready", "busy"]);
    expect(available.map((m) => m.id)).toEqual(["free", "failed"]);
  });
});

describe("rankModels", () => {
  const local = (modelId: string, extra: Partial<LocalBenchModel> = {}): LocalBenchModel => ({
    modelId,
    werPercent: 10,
    cerPercent: 5,
    rtf: 0.1,
    decodeSeconds: 1,
    clips: 4,
    correctedClips: 4,
    selfScoredClips: 0,
    reference: "corrected",
    ...extra,
  });
  const run = (language: string, models: LocalBenchModel[]): LocalBenchRun => ({
    runAt: "2026-10-14T00:00:00Z",
    clips: 4,
    audioSeconds: 20,
    language,
    models,
  });
  const pub = (werPercent: number, speedX?: number) => [
    {
      language: "es" as const,
      werPercent,
      speedX,
      dataset: "FLEURS",
      source: "S",
      url: "https://s",
    },
  ];
  const models = [
    model("a", { benchmarks: pub(3) }),
    model("b", { benchmarks: pub(5, 10), isDefault: true }),
    model("c"),
    model("en-only", { languages: ["en"], benchmarks: pub(1) }),
    model("whisper", { languages: [], languageSummary: "99", benchmarks: pub(4) }),
  ];

  it("ranks by public WER without local runs, keeps only models for the language", () => {
    const rows = rankModels(models, [], "es");
    expect(rows.map((r) => r.id)).toEqual(["a", "whisper", "b", "c"]);
    expect(rows.find((r) => r.id === "b")).toMatchObject({ isDefault: true, speedX: 10 });
    expect(rows.at(-1)?.basis).toBeNull();
  });

  it("puts models with corrected local results first, by local WER and speed", () => {
    const rows = rankModels(
      models,
      [run("es", [local("b", { werPercent: 6, rtf: 0.05 }), local("c", { werPercent: 2 })])],
      "es",
    );
    expect(rows.map((r) => `${r.id}:${r.basis}`)).toEqual([
      "c:local",
      "b:local",
      "a:public",
      "whisper:public",
    ]);
    expect(rows[1]?.speedX).toBeCloseTo(20);
  });

  it("ignores runs in another language and uncorrected results; flags self-scored", () => {
    const self = local("a", { correctedClips: 0, selfScoredClips: 2, werPercent: 0 });
    expect(rankModels(models, [run("en", [local("c")])], "es")[0]?.id).toBe("a");
    const row = rankModels(models, [run("es", [self])], "es")[0];
    expect(row).toMatchObject({ id: "a", basis: "public", werPercent: 3, selfScored: true });
  });
});
