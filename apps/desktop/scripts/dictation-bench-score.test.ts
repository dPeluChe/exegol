import { describe, expect, it } from "vitest";
import {
  charErrorRate,
  editDistance,
  formatTable,
  normalizeText,
  summarizeModel,
  wordErrorRate,
} from "./dictation-bench-score";

describe("normalizeText", () => {
  it("drops case and punctuation, keeps accents and digits", () => {
    expect(normalizeText("  Hola, ¿qué tal? Corre el Docker-Compose v2. ")).toBe(
      "hola qué tal corre el docker compose v2",
    );
  });
});

describe("editDistance", () => {
  it("counts insertions, deletions and substitutions", () => {
    expect(editDistance([..."kitten"], [..."sitting"])).toBe(3);
    expect(editDistance([], ["a", "b"])).toBe(2);
    expect(editDistance(["a"], [])).toBe(1);
    expect(editDistance(["a", "b"], ["a", "b"])).toBe(0);
  });
});

describe("error rates", () => {
  it("WER over normalized words", () => {
    expect(wordErrorRate("Haz el commit y el push.", "haz el comit y el push")).toBeCloseTo(1 / 6);
    expect(wordErrorRate("Hola mundo", "hola, mundo!")).toBe(0);
  });

  it("CER over normalized characters", () => {
    expect(charErrorRate("abcd", "abed")).toBe(0.25);
  });

  it("an empty reference scores 0 only against an empty hypothesis", () => {
    expect(wordErrorRate("", "")).toBe(0);
    expect(wordErrorRate("...", "algo")).toBe(1);
  });
});

describe("summarizeModel", () => {
  it("means per clip, totals and real-time factor", () => {
    const clip = (wer: number, audioSec: number, decodeSec: number) => ({
      clip: "c",
      audioSec,
      decodeSec,
      wer,
      cer: wer / 2,
      reference: "",
      hypothesis: "",
    });
    const row = summarizeModel("m", [clip(0.2, 10, 1), clip(0.4, 30, 3)]);
    expect(row.clips).toBe(2);
    expect(row.meanWer).toBeCloseTo(0.3);
    expect(row.meanCer).toBeCloseTo(0.15);
    expect(row.audioSec).toBe(40);
    expect(row.decodeSec).toBe(4);
    expect(row.rtf).toBeCloseTo(0.1);
    expect(summarizeModel("none", []).rtf).toBe(0);
    expect(formatTable([row]).split("\n")).toHaveLength(3);
  });
});
