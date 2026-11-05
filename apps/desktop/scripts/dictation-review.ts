// Dev only (not shipped): hear each kept dictation and correct its text, which the bench then
// scores against. Usage in docs/GUIDES/DICTATION_BENCH.md.
//   bun apps/desktop/scripts/dictation-review.ts [--dir DIR] [--limit N] [--skip-unchanged]
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { EXEGOL_DIR } from "../src/main/terminal/pty-sidecar-protocol";

const args = process.argv.slice(2);
const value = (name: string) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const dir = resolve(value("--dir") ?? join(EXEGOL_DIR, "dictation-audio"));
const limit = Number(value("--limit") ?? Number.POSITIVE_INFINITY);
const skipUnchanged = args.includes("--skip-unchanged");
const editor = process.env.EDITOR ?? "vi";

function pending(current: string): string[] {
  return readdirSync(current, { withFileTypes: true }).flatMap((e) => {
    const path = join(current, e.name);
    if (e.isDirectory()) return pending(path);
    if (!e.name.endsWith(".json") || !existsSync(path.replace(/\.json$/, ".wav"))) return [];
    const meta = JSON.parse(readFileSync(path, "utf8")) as { reference?: string };
    return typeof meta.reference === "string" ? [] : [path];
  });
}

const clips = pending(dir)
  .sort((a, b) => b.localeCompare(a))
  .slice(0, limit);
const workDir = mkdtempSync(join(tmpdir(), "exegol-dictation-review-"));
const draft = join(workDir, "reference.txt");
console.log(`${clips.length} clips without a reference`);
for (const [i, path] of clips.entries()) {
  const meta = JSON.parse(readFileSync(path, "utf8")) as { text?: string; durationMs?: number };
  const text = meta.text ?? "";
  writeFileSync(draft, text, { mode: 0o600 });
  console.log(`${i + 1}/${clips.length}: ${Math.round((meta.durationMs ?? 0) / 1000)} s`);
  const player = spawn("afplay", [path.replace(/\.json$/, ".wav")], { stdio: "ignore" });
  const [command = "vi", ...flags] = editor.split(" ");
  const edited = spawnSync(command, [...flags, draft], { stdio: "inherit" });
  player.kill();
  if (edited.status !== 0) break;
  const reference = readFileSync(draft, "utf8").trim();
  if (!reference || (skipUnchanged && reference === text.trim())) continue;
  writeFileSync(path, `${JSON.stringify({ ...meta, reference }, null, 2)}\n`, { mode: 0o600 });
}
rmSync(workDir, { recursive: true, force: true });
