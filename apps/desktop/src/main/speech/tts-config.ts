import { join } from "node:path";
import type { VoiceModelEntry, VoiceSpeaker } from "@exegol/shared";

/** What the speech process loads: the sherpa-onnx OfflineTts config plus its cache key */
export interface TtsSpec {
  /** Same key, same loaded engine: the config's language is fixed at load */
  key: string;
  config: {
    model: {
      kokoro: {
        model: string;
        voices: string;
        tokens: string;
        dataDir: string;
        lexicon: string;
        lang: string;
      };
      numThreads: number;
      provider: "cpu";
      debug: 0;
    };
    maxNumSentences: number;
  };
}

export function voiceOf(entry: VoiceModelEntry, voiceId: string): VoiceSpeaker | undefined {
  return entry.voices.find((v) => v.id === voiceId) ?? entry.voices[0];
}

/** Kokoro through sherpa-onnx; the one place that knows its file names and config fields */
export function ttsSpec(
  entry: VoiceModelEntry,
  dir: string,
  voice: VoiceSpeaker,
  threads: number,
): TtsSpec {
  return {
    key: `${entry.id}:${voice.lang}:${threads}`,
    config: {
      model: {
        kokoro: {
          model: join(dir, "model.int8.onnx"),
          voices: join(dir, "voices.bin"),
          tokens: join(dir, "tokens.txt"),
          dataDir: join(dir, "espeak-ng-data"),
          lexicon: join(dir, "lexicon-us-en.txt"),
          lang: voice.lang,
        },
        numThreads: threads,
        provider: "cpu",
        debug: 0,
      },
      maxNumSentences: 1,
    },
  };
}
