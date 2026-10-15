import { describe, expect, it } from "vitest";
import {
  decodeWav,
  encodeWav,
  expiredRecordings,
  projectDirName,
  type RecordingFile,
  recordingBaseName,
  recordingStem,
  summarizeRecordings,
} from "./recording-files";

const DAY = 86_400_000;
const NOW = 100 * DAY;
const file = (project: string, name: string, bytes: number, ageDays: number): RecordingFile => ({
  project,
  name,
  bytes,
  mtimeMs: NOW - ageDays * DAY,
});

describe("encodeWav", () => {
  it("writes a 16-bit mono PCM header", () => {
    const wav = encodeWav([new Float32Array([0, 0.5]), new Float32Array([-1])], 16_000);
    expect(wav.length).toBe(44 + 6);
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.readUInt32LE(4)).toBe(36 + 6);
    expect(wav.toString("ascii", 8, 16)).toBe("WAVEfmt ");
    expect(wav.readUInt16LE(20)).toBe(1);
    expect(wav.readUInt16LE(22)).toBe(1);
    expect(wav.readUInt32LE(24)).toBe(16_000);
    expect(wav.readUInt32LE(28)).toBe(32_000);
    expect(wav.readUInt16LE(32)).toBe(2);
    expect(wav.readUInt16LE(34)).toBe(16);
    expect(wav.toString("ascii", 36, 40)).toBe("data");
    expect(wav.readUInt32LE(40)).toBe(6);
    expect([wav.readInt16LE(44), wav.readInt16LE(46), wav.readInt16LE(48)]).toEqual([
      0, 16_384, -32_768,
    ]);
  });

  it("clamps out of range samples", () => {
    const wav = encodeWav([new Float32Array([2, -3])], 16_000);
    expect([wav.readInt16LE(44), wav.readInt16LE(46)]).toEqual([32_767, -32_768]);
  });

  it("round-trips through decodeWav", () => {
    const decoded = decodeWav(encodeWav([new Float32Array([0.25, -0.5])], 16_000));
    expect(decoded?.sampleRate).toBe(16_000);
    expect([...(decoded?.samples ?? [])].map((s) => Math.round(s * 100) / 100)).toEqual([
      0.25, -0.5,
    ]);
  });

  it("decodeWav refuses what is not 16-bit PCM", () => {
    expect(decodeWav(Buffer.from("not a wav file at all"))).toBeNull();
    const wav = encodeWav([new Float32Array([0])], 16_000);
    wav.writeUInt16LE(32, 34);
    expect(decodeWav(wav)).toBeNull();
  });
});

describe("names", () => {
  it("keeps plain project ids, else no-project", () => {
    expect(projectDirName("abc_DEF-123")).toBe("abc_DEF-123");
    expect(projectDirName(null)).toBe("no-project");
    expect(projectDirName("../etc")).toBe("no-project");
    expect(projectDirName("")).toBe("no-project");
  });

  it("names a recording by time without colons", () => {
    expect(recordingBaseName(new Date("2026-10-14T09:05:03.120Z"), "abcdef123456")).toBe(
      "2026-10-14T09-05-03.120Z-abcdef",
    );
    expect(recordingStem("x.wav")).toBe("x");
    expect(recordingStem("x.json")).toBe("x");
    expect(recordingStem(".DS_Store")).toBeNull();
  });
});

describe("expiredRecordings", () => {
  it("drops pairs past the retention, keeps newer ones and other files", () => {
    const files = [
      file("p1", "old.wav", 10, 11),
      file("p1", "old.json", 1, 11),
      file("p1", "new.wav", 10, 2),
      file("p1", "new.json", 1, 2),
      file("p1", "notes.txt", 1, 50),
    ];
    expect(expiredRecordings(files, 10, NOW).map((f) => f.name)).toEqual(["old.wav", "old.json"]);
  });

  it("keeps a pair whole while one of its files is recent", () => {
    const files = [file("p1", "a.wav", 10, 20), file("p1", "a.json", 1, 1)];
    expect(expiredRecordings(files, 10, NOW)).toEqual([]);
  });
});

describe("summarizeRecordings", () => {
  it("counts a wav and json pair once, per project, largest first", () => {
    const files = [
      file("p1", "a.wav", 100, 1),
      file("p1", "a.json", 5, 1),
      file("no-project", "b.wav", 300, 1),
      file("no-project", "b.json", 5, 1),
      file("no-project", "c.wav", 50, 1),
      file("p1", "readme.md", 999, 1),
    ];
    const summary = summarizeRecordings(files, (id) => (id === "p1" ? "Argos" : null));
    expect(summary.count).toBe(3);
    expect(summary.bytes).toBe(460);
    expect(summary.projects).toEqual([
      { projectId: null, projectName: null, count: 2, bytes: 355 },
      { projectId: "p1", projectName: "Argos", count: 1, bytes: 105 },
    ]);
  });

  it("is empty with no files", () => {
    expect(summarizeRecordings([], () => null)).toEqual({ count: 0, bytes: 0, projects: [] });
  });
});
