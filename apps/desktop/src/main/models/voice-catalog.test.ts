import { DEFAULT_COMMANDER_VOICE } from "@exegol/shared";
import { describe, expect, it } from "vitest";
import { specPaths } from "../dictation/model-config";
import { ttsSpec, voiceOf } from "../speech/tts-config";
import { VOICE_CATALOG } from "./voice-catalog";

describe("voice model catalog", () => {
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
      for (const path of specPaths(spec.config)) {
        expect(kept, path).toContain(path.slice(dir.length + 1));
      }
      const other = entry.voices.find((v) => v.lang !== voice.lang);
      if (other) expect(ttsSpec(entry, dir, other, 2).key).not.toBe(spec.key);
    }
  });
});
