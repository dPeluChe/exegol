import { DICTATION_SAMPLE_RATE } from "@exegol/shared";
import { describe, expect, it } from "vitest";
import {
  joinPhrases,
  SEGMENTER_START,
  type Segmenter,
  segment,
  tailHasSpeech,
  WHISPER_MIN_PHRASE_MS,
} from "./phrases";

const CHUNK = DICTATION_SAMPLE_RATE / 10;
const speech = () => new Float32Array(CHUNK).fill(0.1);
const silence = () => new Float32Array(CHUNK);

/** Feeds 100 ms chunks: "s" speech, "." silence. Returns the cuts and the final state */
function run(pattern: string, minPhraseMs = 0) {
  let state: Segmenter = SEGMENTER_START;
  const cuts: { from: number; to: number }[] = [];
  for (const c of pattern) {
    const out = segment(state, c === "s" ? speech() : silence(), minPhraseMs);
    state = out.state;
    if (out.cut) cuts.push(out.cut);
  }
  return { cuts, state };
}

describe("segment", () => {
  it("cuts a phrase after half a second of pause", () => {
    const { cuts, state } = run("ssss.....");
    expect(cuts).toEqual([{ from: 0, to: 9 * CHUNK }]);
    expect(state.start).toBe(9 * CHUNK);
  });

  it("does not cut on a short pause inside a phrase", () => {
    expect(run("ssss...ssss").cuts).toEqual([]);
  });

  it("ignores a click: too little speech for a phrase", () => {
    expect(run("s......").cuts).toEqual([]);
  });

  it("drops leading silence but keeps a short pre-roll before speech", () => {
    const { cuts } = run("..........ssss.....");
    expect(cuts).toHaveLength(1);
    expect(cuts[0]?.from).toBe(7 * CHUNK);
  });

  it("cuts two phrases in order", () => {
    const { cuts } = run("sss.....sss.....");
    expect(cuts).toHaveLength(2);
    expect(cuts[1]?.from).toBe(cuts[0]?.to);
  });

  it("never lets a phrase grow past the window a model decodes", () => {
    const { cuts, state } = run("s".repeat(260));
    expect(cuts).toHaveLength(1);
    const to = cuts[0]?.to ?? 0;
    expect(to).toBeLessThanOrEqual(250 * CHUNK);
    expect(to).toBeGreaterThan(230 * CHUNK);
    expect(state.start).toBe(to);
  });

  it("cuts a capped phrase at the quietest moment of its last 2 s", () => {
    const { cuts } = run(`${"s".repeat(240)}.${"s".repeat(19)}`);
    expect(cuts).toHaveLength(1);
    const to = cuts[0]?.to ?? 0;
    expect(to).toBeGreaterThan(240 * CHUNK);
    expect(to).toBeLessThan(241 * CHUNK);
  });

  it("with a minimum phrase length, a pause cuts only a long enough phrase", () => {
    expect(run("ssss.....", WHISPER_MIN_PHRASE_MS).cuts).toEqual([]);
    const long = `${"s".repeat(100)}.....`;
    expect(run(long, WHISPER_MIN_PHRASE_MS).cuts).toEqual([{ from: 0, to: 105 * CHUNK }]);
  });

  it("decodes the tail at stop only when it holds speech", () => {
    expect(tailHasSpeech(run("sss").state)).toBe(true);
    expect(tailHasSpeech(run("sss.....").state)).toBe(false);
    expect(tailHasSpeech(run("....").state)).toBe(false);
  });
});

describe("joinPhrases", () => {
  it("joins with single spaces and skips empty phrases", () => {
    expect(joinPhrases([" Hola ", "", "qué tal  estás"])).toBe("Hola qué tal estás");
    expect(joinPhrases(["", " "])).toBe("");
  });
});
