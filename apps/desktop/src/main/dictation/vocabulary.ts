import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { EXEGOL_DIR } from "../terminal/pty-sidecar-protocol";
import {
  bpeVocabFromTokens,
  type VocabularySpec,
  vocabularyHash,
  vocabularyUse,
} from "./model-config";

/** The file the engine reads for a vocabulary (the bpe vocab): outside the models folder, which stays as downloaded */
export const VOCAB_DIR = join(EXEGOL_DIR, "dictation-vocab");

/** What a dictation used, for its recording's .json: counts and a hash, never the words */
export interface VocabularyInfo {
  terms: number;
  hash: string;
  /** The model biases toward them; false = saved but this model ignores them */
  applied: boolean;
}

/** Written contents per path this run: a start with the same vocabulary writes nothing */
const written = new Map<string, string>();

async function writeOnce(path: string, content: () => Promise<string> | string, key: string) {
  if (written.get(path) === key && existsSync(path)) return;
  await writeFile(path, await content(), { mode: 0o600 });
  written.set(path, key);
}

/** The vocabulary for this model, its files written when they changed; null when there is none
 *  or the model cannot use one */
export async function prepareVocabulary(
  modelId: string,
  modelDir: string,
  terms: string[],
  score: number,
): Promise<{ spec: VocabularySpec | null; info: VocabularyInfo | null }> {
  if (terms.length === 0) return { spec: null, info: null };
  const hash = vocabularyHash(terms, score);
  const use = vocabularyUse(modelId);
  const info = { terms: terms.length, hash, applied: use !== null };
  const bpeVocab = join(VOCAB_DIR, `${modelId}.bpe.vocab`);
  const spec = { terms, score, bpeVocab };
  if (use !== "hotwords") return { spec: use ? spec : null, info };
  await mkdir(VOCAB_DIR, { recursive: true, mode: 0o700 });
  await writeOnce(
    bpeVocab,
    async () => bpeVocabFromTokens(await readFile(join(modelDir, "tokens.txt"), "utf8")),
    modelDir,
  );
  return { spec, info };
}
