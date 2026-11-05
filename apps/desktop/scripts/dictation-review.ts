// Dev only (not shipped): hear each kept dictation and correct its text, which the bench then
// scores against. Usage in docs/GUIDES/DICTATION_BENCH.md.
//   bun apps/desktop/scripts/dictation-review.ts [--dir DIR] [--limit N]
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  RECORDINGS_DIR,
  type RecordingMeta,
  recordingJsonPaths,
} from "../src/main/dictation/recording-files";

const args = process.argv.slice(2);
const value = (name: string) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const dir = resolve(value("--dir") ?? RECORDINGS_DIR);
const limit = Number(value("--limit") ?? Number.POSITIVE_INFINITY);
const [editor = "vi", ...editorFlags] = (process.env.EDITOR ?? "vi").split(" ");

const clips = recordingJsonPaths(dir)
  .map((path) => ({
    path,
    meta: JSON.parse(readFileSync(path, "utf8")) as Partial<RecordingMeta>,
  }))
  .filter((c) => typeof c.meta.reference !== "string")
  .sort((a, b) => b.path.localeCompare(a.path))
  .slice(0, limit);

const workDir = mkdtempSync(join(tmpdir(), "exegol-dictation-review-"));
const draft = join(workDir, "reference.txt");
console.log(`${clips.length} clips without a reference`);
for (const [i, { path, meta }] of clips.entries()) {
  writeFileSync(draft, meta.text ?? "", { mode: 0o600 });
  console.log(`${i + 1}/${clips.length}: ${Math.round((meta.durationMs ?? 0) / 1000)} s`);
  const player = spawn("afplay", [path.replace(/\.json$/, ".wav")], { stdio: "ignore" });
  const edited = spawnSync(editor, [...editorFlags, draft], { stdio: "inherit" });
  player.kill();
  if (edited.status !== 0) break;
  const reference = readFileSync(draft, "utf8").trim();
  if (reference) {
    writeFileSync(path, `${JSON.stringify({ ...meta, reference }, null, 2)}\n`, { mode: 0o600 });
  }
}
rmSync(workDir, { recursive: true, force: true });
