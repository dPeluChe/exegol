// Dev only (not shipped): decodes kept dictation recordings with each speech model and scores
// them against the text saved next to each clip. Usage in docs/GUIDES/DICTATION_BENCH.md.
//   bun apps/desktop/scripts/dictation-bench.ts [--dir DIR] [--model DIR[=catalogId]]...
//     [--no-installed] [--threads N] [--language en|es] [--vocab FILE] [--json out.json] [--save]
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import {
  DEFAULT_DICTATION_SETTINGS,
  DICTATION_LANGUAGE_IDS,
  type DictationLanguage,
  type LocalBenchModel,
  parseVocabulary,
  DICTATION_SAMPLE_RATE as SAMPLE_RATE,
  type SpeechModelEntry,
} from "@exegol/shared";
import * as sherpa from "sherpa-onnx-node";
import {
  bpeVocabFromTokens,
  hasRecognizer,
  recognizerSpec,
  type VocabularySpec,
  vocabularyHash,
  vocabularyUse,
} from "../src/main/dictation/model-config";
import {
  decodeWithVocabulary,
  joinPhrases,
  SEGMENTER_START,
  segment,
  tailHasSpeech,
  WHISPER_MIN_PHRASE_MS,
} from "../src/main/dictation/phrases";
import { decodeWav } from "../src/main/dictation/recording-files";
import {
  BENCH_RESULTS_DIR,
  BENCH_RESULTS_FILE,
  mergeBenchRun,
  parseBenchResults,
} from "../src/main/models/bench-results";
import { MODEL_CATALOG } from "../src/main/models/catalog";
import { EXEGOL_DIR } from "../src/main/terminal/pty-sidecar-protocol";
import {
  type ClipResult,
  charErrorRate,
  formatTable,
  localBenchModel,
  type ModelRow,
  summarizeModel,
  wordErrorRate,
} from "./dictation-bench-score";

/** The renderer's capture chunk (~100 ms): phrases are cut where the app would cut them */
const CHUNK = SAMPLE_RATE / 10;

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const values = (name: string) =>
  args.flatMap((a, i) => (a === name && args[i + 1] ? [args[i + 1] as string] : []));
const recordingsDir = resolve(values("--dir")[0] ?? join(EXEGOL_DIR, "dictation-audio"));
const jsonOut = values("--json")[0];
const threads = Number(values("--threads")[0] ?? 4);
const language = (values("--language")[0] ?? "en") as DictationLanguage;
if (!DICTATION_LANGUAGE_IDS.includes(language)) {
  console.error(`--language must be one of ${DICTATION_LANGUAGE_IDS.join(", ")}`);
  process.exit(1);
}
const vocabFile = values("--vocab")[0];
const vocabTerms = vocabFile ? parseVocabulary(readFileSync(resolve(vocabFile), "utf8")) : [];
const vocabScore = Number(values("--boost")[0] ?? DEFAULT_DICTATION_SETTINGS.vocabularyBoost);
const vocabHash = vocabularyHash(vocabTerms, vocabScore);

interface Clip {
  name: string;
  samples: Float32Array;
  reference: string;
  corrected: boolean;
  dictatedWith: string | null;
}

interface ModelTarget {
  label: string;
  entry: SpeechModelEntry;
  dir: string;
}

const installed = (entry: SpeechModelEntry, dir: string) =>
  entry.files.every((f) => existsSync(join(dir, f)));

/** `--model DIR=id`, else the folder name when it is a catalog id, else the first family whose files are there */
function extraModel(arg: string): ModelTarget | null {
  const [path = "", id] = arg.split("=");
  const dir = resolve(path);
  const entry =
    MODEL_CATALOG.find((m) => m.id === (id ?? basename(dir))) ??
    MODEL_CATALOG.find((m) => hasRecognizer(m.id) && installed(m, dir));
  return entry ? { label: `${entry.id} (${dir})`, entry, dir } : null;
}

function modelTargets(): ModelTarget[] {
  const list: ModelTarget[] = flag("--no-installed")
    ? []
    : MODEL_CATALOG.filter((m) => hasRecognizer(m.id))
        .map((entry) => ({ label: entry.id, entry, dir: join(EXEGOL_DIR, "models", entry.id) }))
        .filter((t) => installed(t.entry, t.dir));
  for (const arg of values("--model")) {
    const target = extraModel(arg);
    if (target) list.push(target);
    else console.error(`skipped ${arg}: no known model family in that folder`);
  }
  return list;
}

function loadClips(dir: string): Clip[] {
  const clips: Clip[] = [];
  const walk = (current: string) => {
    for (const e of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, e.name);
      if (e.isDirectory()) walk(path);
      if (!e.isFile() || !e.name.endsWith(".json")) continue;
      const wav = path.replace(/\.json$/, ".wav");
      if (!existsSync(wav)) continue;
      const meta = JSON.parse(readFileSync(path, "utf8")) as {
        text?: string;
        reference?: string;
        modelId?: string;
      };
      const audio = decodeWav(readFileSync(wav));
      const reference = meta.reference ?? meta.text;
      if (!audio || audio.sampleRate !== SAMPLE_RATE || typeof reference !== "string") {
        console.error(`skipped ${path}: not a 16 kHz recording with text`);
        continue;
      }
      clips.push({
        name: path.slice(dir.length + 1),
        samples: audio.samples,
        reference,
        corrected: typeof meta.reference === "string",
        dictatedWith: meta.modelId ?? null,
      });
    }
  };
  if (existsSync(dir)) walk(dir);
  return clips.sort((a, b) => a.name.localeCompare(b.name));
}

/** The --vocab terms as the engine would build them, the bpe vocab in a temp folder */
function benchVocabulary(target: ModelTarget): VocabularySpec | null {
  if (vocabTerms.length === 0 || !vocabularyUse(target.entry.id)) return null;
  const dir = mkdtempSync(join(tmpdir(), "exegol-bench-vocab-"));
  const bpeVocab = join(dir, "model.bpe.vocab");
  const tokens = join(target.dir, "tokens.txt");
  if (existsSync(tokens)) writeFileSync(bpeVocab, bpeVocabFromTokens(readFileSync(tokens, "utf8")));
  return { terms: vocabTerms, score: vocabScore, hash: vocabHash, bpeVocab };
}

/** The engine's offline path: phrases cut at pauses, each through decodeWithVocabulary, the tail
 *  at the end, one full pass when nothing came out */
async function decodeAsApp(
  samples: Float32Array,
  decode: (audio: Float32Array, speechMs: number) => Promise<string>,
  minPhraseMs: number,
): Promise<string> {
  let seg = SEGMENTER_START;
  const texts: string[] = [];
  for (let at = 0; at < samples.length; at += CHUNK) {
    const { state, cut } = segment(seg, samples.subarray(at, at + CHUNK), minPhraseMs);
    seg = state;
    if (cut) texts.push(await decode(samples.subarray(cut.from, cut.to), cut.speechMs));
  }
  if (tailHasSpeech(seg))
    texts.push(await decode(samples.subarray(seg.start, seg.end), seg.speechMs));
  return joinPhrases(texts) || decode(samples, Number.POSITIVE_INFINITY);
}

async function decoder(target: ModelTarget): Promise<(samples: Float32Array) => Promise<string>> {
  const spec = recognizerSpec(target.entry, target.dir, threads, language, benchVocabulary(target));
  if (!spec) throw new Error(`${target.entry.id} has no recognizer`);
  if (spec.kind === "offline") {
    const recognizer = await sherpa.OfflineRecognizer.createAsync(spec.config);
    const minPhraseMs = spec.config.modelConfig.whisper ? WHISPER_MIN_PHRASE_MS : 0;
    const decode = async (audio: Float32Array, speechMs: number) => {
      const run = async (words: string | null) => {
        const stream = words ? recognizer.createStream(words) : recognizer.createStream();
        stream.acceptWaveform({ samples: audio, sampleRate: SAMPLE_RATE });
        return (await recognizer.decodeAsync(stream)).text.trim();
      };
      return (await decodeWithVocabulary(run, spec.hotwords ?? null, speechMs)).text;
    };
    return (samples) => decodeAsApp(samples, decode, minPhraseMs);
  }
  const recognizer = new sherpa.OnlineRecognizer(spec.config);
  return async (samples) => {
    const stream = recognizer.createStream();
    stream.acceptWaveform({ samples, sampleRate: SAMPLE_RATE });
    // Same trailing silence as the engine: the streaming model emits its last words
    stream.acceptWaveform({
      samples: new Float32Array(SAMPLE_RATE * 0.4),
      sampleRate: SAMPLE_RATE,
    });
    stream.inputFinished();
    while (recognizer.isReady(stream)) recognizer.decode(stream);
    return recognizer.getResult(stream).text.trim();
  };
}

async function main(): Promise<void> {
  const clips = loadClips(recordingsDir);
  const targets = modelTargets();
  if (clips.length === 0) {
    console.error(`no recordings in ${recordingsDir}`);
    process.exit(1);
  }
  if (targets.length === 0) {
    console.error("no models: install one in Settings > Models or pass --model DIR");
    process.exit(1);
  }
  const rows: ModelRow[] = [];
  const saved: LocalBenchModel[] = [];
  const details: Record<string, ClipResult[]> = {};
  for (const target of targets) {
    console.error(`${target.label}: loading`);
    const decode = await decoder(target);
    const results: ClipResult[] = [];
    for (const clip of clips) {
      const started = performance.now();
      const hypothesis = await decode(clip.samples);
      results.push({
        clip: clip.name,
        audioSec: clip.samples.length / SAMPLE_RATE,
        decodeSec: (performance.now() - started) / 1000,
        wer: wordErrorRate(clip.reference, hypothesis),
        cer: charErrorRate(clip.reference, hypothesis),
        reference: clip.reference,
        hypothesis,
        corrected: clip.corrected,
        dictatedWith: clip.dictatedWith,
      });
    }
    rows.push(summarizeModel(target.label, results));
    saved.push(localBenchModel(target.entry.id, results));
    details[target.label] = results;
  }
  console.log(formatTable(rows));
  if (jsonOut) {
    writeFileSync(jsonOut, `${JSON.stringify({ recordingsDir, rows, clips: details }, null, 2)}\n`);
    console.error(`wrote ${jsonOut}`);
  }
  if (flag("--save")) saveRun(clips, saved);
}

/** Merges this run into results.json (scores only, never text) for Settings > Models */
function saveRun(clips: readonly Clip[], models: LocalBenchModel[]): void {
  mkdirSync(BENCH_RESULTS_DIR, { recursive: true, mode: 0o700 });
  chmodSync(BENCH_RESULTS_DIR, 0o700);
  const existing = existsSync(BENCH_RESULTS_FILE) ? readFileSync(BENCH_RESULTS_FILE, "utf8") : null;
  const file = mergeBenchRun(parseBenchResults(existing), {
    runAt: new Date().toISOString(),
    clips: clips.length,
    audioSeconds: Number(
      (clips.reduce((n, c) => n + c.samples.length, 0) / SAMPLE_RATE).toFixed(1),
    ),
    language,
    ...(vocabTerms.length > 0 && {
      vocabulary: { terms: vocabTerms.length, hash: vocabHash },
    }),
    models,
  });
  writeFileSync(BENCH_RESULTS_FILE, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
  chmodSync(BENCH_RESULTS_FILE, 0o600);
  console.error(`saved to ${BENCH_RESULTS_FILE} (${file.runs.length} runs kept)`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
