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

type Prepared = { spec: VocabularySpec | null; info: VocabularyInfo | null };

/** The model dir each bpe vocab was written from this run: a start with the same model writes nothing */
const written = new Map<string, string>();
/** The last vocabulary prepared: warm-up and the start that follows share it */
let last: { key: string; prepared: Prepared } | null = null;

/** A file was deleted under us (the engine saw ENOENT): the next start writes it again */
export function forgetVocabularyFiles(): void {
  written.clear();
  last = null;
}

/** The vocabulary for this model, its files written when they changed; null when there is none
 *  or the model cannot use one */
export async function prepareVocabulary(
  modelId: string,
  modelDir: string,
  terms: string[],
  score: number,
): Promise<Prepared> {
  if (terms.length === 0) return { spec: null, info: null };
  const key = JSON.stringify([modelId, modelDir, score, terms]);
  if (last?.key === key) return last.prepared;
  const hash = vocabularyHash(terms, score);
  const use = vocabularyUse(modelId);
  const info = { terms: terms.length, hash, applied: use !== null };
  const bpeVocab = join(VOCAB_DIR, `${modelId}.bpe.vocab`);
  const spec = { terms, score, hash, bpeVocab };
  if (use === "hotwords" && written.get(bpeVocab) !== modelDir) {
    await mkdir(VOCAB_DIR, { recursive: true, mode: 0o700 });
    const tokens = await readFile(join(modelDir, "tokens.txt"), "utf8");
    await writeFile(bpeVocab, bpeVocabFromTokens(tokens), { mode: 0o600 });
    written.set(bpeVocab, modelDir);
  }
  const prepared = { spec: use ? spec : null, info };
  last = { key, prepared };
  return prepared;
}
