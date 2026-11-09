import type { DownloadableModel, VoiceModelEntry, VoiceSpeaker } from "@exegol/shared";
import { findModel } from "./catalog";

// Hash, sizes and speaker ids checked against the downloaded asset on 2026-11-09 (speaker ids from
// the model's own `id2speaker` metadata; British voices left out: lang en-gb gave no audio)
const KOKORO_ROOT = "kokoro-int8-multi-lang-v1_0";

const speaker = (id: string, label: string, lang: string, speakerId: number): VoiceSpeaker => ({
  id,
  label,
  lang,
  speakerId,
});

const KOKORO_VOICES: readonly VoiceSpeaker[] = [
  speaker("em_alex", "Alex (Spanish)", "es", 29),
  speaker("em_santa", "Santa (Spanish)", "es", 53),
  speaker("ef_dora", "Dora (Spanish)", "es", 28),
  speaker("af_heart", "Heart (English)", "en-us", 3),
  speaker("af_bella", "Bella (English)", "en-us", 2),
  speaker("am_michael", "Michael (English)", "en-us", 16),
  speaker("am_adam", "Adam (English)", "en-us", 11),
];

const DEFAULT_VOICE_MODEL_ID = "kokoro-multi-lang-v1.0-int8";

export const VOICE_CATALOG: readonly VoiceModelEntry[] = [
  {
    id: DEFAULT_VOICE_MODEL_ID,
    name: "Kokoro 82M multi-language int8",
    engine: "kokoro",
    engineAvailable: true,
    languages: ["es", "en"],
    bestFor: "Reads replies aloud in Spanish and English",
    sizeBytes: 132_353_410,
    installedBytes: 166_364_534,
    license: "Apache-2.0",
    attribution:
      "Kokoro-82M v1.0 by hexgrad, Apache-2.0 (huggingface.co/hexgrad/Kokoro-82M). Converted to ONNX by the sherpa-onnx project (k2-fsa, Apache-2.0); pronunciation data from eSpeak NG (GPL-3.0).",
    sourceUrl: `https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/${KOKORO_ROOT}.tar.bz2`,
    sha256: "72c347230107ef8a31098ec4d468a605244beef5f1ed00db97efa13518800653",
    archive: "tar.bz2",
    rootDir: KOKORO_ROOT,
    files: ["model.int8.onnx", "voices.bin", "tokens.txt", "lexicon-us-en.txt"],
    keepDirs: ["espeak-ng-data"],
    voices: [...KOKORO_VOICES],
  },
];

function findVoiceModel(id: string): VoiceModelEntry | undefined {
  return VOICE_CATALOG.find((m) => m.id === id);
}

/** A model of either catalog: what the shared download, extract and delete path handles */
export function findDownloadable(id: string): DownloadableModel | undefined {
  return findModel(id) ?? findVoiceModel(id);
}
