import { DEFAULT_COMMANDER_VOICE } from "@exegol/shared";
import { describe, expect, it } from "vitest";
import { specPaths } from "../dictation/model-config";
import { ttsSpec, voiceOf } from "../speech/tts-config";
import { findModel, MODEL_CATALOG } from "./catalog";
import { findDownloadable, VOICE_CATALOG } from "./voice-catalog";

describe("voice model catalog", () => {
  it("is well formed, pinned and kept apart from the dictation models", () => {
    for (const entry of VOICE_CATALOG) {
      expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(entry.sourceUrl.startsWith("https://")).toBe(true);
      expect(entry.sourceUrl.endsWith(`/${entry.rootDir}.tar.bz2`)).toBe(true);
      expect(entry.installedBytes).toBeGreaterThan(0);
      expect(entry.license).toBe("Apache-2.0");
      expect(entry.commercialUse).not.toBe(false);
      expect(findModel(entry.id)).toBeUndefined();
      expect(findDownloadable(entry.id)).toBe(entry);
      for (const p of [...entry.files, ...(entry.keepDirs ?? [])]) {
        expect(p.startsWith("/") || p.split("/").includes("..")).toBe(false);
      }
    }
    expect(MODEL_CATALOG.every((m) => findDownloadable(m.id) === m)).toBe(true);
  });

  it("offers distinct voices with Spanish first and the default among them", () => {
    for (const entry of VOICE_CATALOG) {
      const ids = entry.voices.map((v) => v.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(new Set(entry.voices.map((v) => v.speakerId)).size).toBe(ids.length);
      expect(entry.voices[0]?.lang).toBe("es");
      expect(ids).toContain(DEFAULT_COMMANDER_VOICE.voice);
    }
  });

  it("builds an engine config that reads only files the catalog keeps", () => {
    for (const entry of VOICE_CATALOG) {
      const dir = "/models/x";
      const voice = voiceOf(entry, "no-such-voice");
      if (!voice) throw new Error("no voices");
      const spec = ttsSpec(entry, dir, voice, 2);
      const kept = [...entry.files, ...(entry.keepDirs ?? [])];
      for (const path of specPaths(spec?.config)) {
        expect(kept, path).toContain(path.slice(dir.length + 1));
      }
      const other = entry.voices.find((v) => v.lang !== voice.lang);
      if (other) expect(ttsSpec(entry, dir, other, 2)?.key).not.toBe(spec?.key);
    }
  });
});
