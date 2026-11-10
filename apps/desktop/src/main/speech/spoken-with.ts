import { createHash } from "node:crypto";

export interface SpokenWith {
  voice: string;
  speed: number;
  model: string;
}

const MAX = 200;
const spoken = new Map<string, SpokenWith>();

const keyOf = (sentences: readonly string[]) =>
  createHash("sha1").update(sentences.join("\n")).digest("hex");

/** The voice a reply was last read with, so a later mark names it and not today's setting */
export function noteSpokenWith(sentences: readonly string[], how: SpokenWith): void {
  const key = keyOf(sentences);
  spoken.delete(key);
  spoken.set(key, how);
  const oldest = spoken.keys().next().value;
  if (spoken.size > MAX && oldest !== undefined) spoken.delete(oldest);
}

export function spokenWith(sentences: readonly string[]): SpokenWith | undefined {
  return spoken.get(keyOf(sentences));
}
