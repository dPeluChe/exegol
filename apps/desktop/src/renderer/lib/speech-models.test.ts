import type { ModelListItem, ModelStatus } from "@exegol/shared";
import { describe, expect, it } from "vitest";
import {
  chooserOptions,
  etaSeconds,
  formatEta,
  initialChoice,
  languagesLabel,
  lowDisk,
  needsAttribution,
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
