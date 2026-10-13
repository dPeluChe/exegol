// Local test build: `bun run package:local [-- --dry-run]`. Docs: docs/GUIDES/RELEASE.md.
// Version <next patch>-test.<sha> (package.json untouched), signed, never notarized, mac arm64 DMG
// in dist/local/ (replaced each run), named Exegol-TEST-<version>.dmg.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { testBuildVersion } from "../../../packages/shared/src/lib/test-build";

const dryRun = process.argv.includes("--dry-run");
const desktop = resolve(__dirname, "..");
const outDir = join(desktop, "dist", "local");

function fail(message: string): never {
  console.error(`[package:local] ${message}`);
  process.exit(1);
}

function git(...args: string[]): string {
  const r = spawnSync("git", args, { cwd: desktop, encoding: "utf8" });
  if (r.status !== 0) fail(`git ${args.join(" ")} failed: ${r.stderr.trim()}`);
  return r.stdout.trim();
}

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv = process.env): void {
  console.log(`[package:local] ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { cwd: desktop, env, stdio: "inherit" });
  if (r.status !== 0) fail(`${cmd} exited with ${r.status ?? r.signal}`);
}

if (process.platform !== "darwin") fail("macOS only (signed arm64 DMG)");

const pkg = JSON.parse(readFileSync(join(desktop, "package.json"), "utf8")) as { version?: string };
const sha = git("rev-parse", "--short=7", "HEAD");
const dirty = git("status", "--porcelain").length > 0;
const version = testBuildVersion(pkg.version ?? "", sha, dirty);
if (!version) fail(`cannot derive a test version from ${pkg.version} at ${sha}`);
const dmg = join(outDir, `Exegol-TEST-${version}.dmg`);

console.log(`[package:local] version ${version}${dirty ? " (uncommitted changes included)" : ""}`);
console.log(`[package:local] output  ${outDir} (previous local build removed first)`);
if (dryRun) {
  console.log(`[package:local] dry run: would build ${dmg}`);
  process.exit(0);
}

rmSync(outDir, { recursive: true, force: true });
run("electron-vite", ["build"]);
// A notarytool profile in the shell must not make a throwaway build wait on Apple
const { APPLE_KEYCHAIN_PROFILE: _skip, ...env } = process.env;
run(
  "electron-builder",
  ["--config", "electron-builder.ts", "--mac", "dmg", "--arm64", "--publish", "never"],
  { ...env, EXEGOL_LOCAL_VERSION: version },
);
if (!existsSync(dmg)) fail(`build finished but ${dmg} is missing`);
console.log(`\n[package:local] DMG: ${dmg}`);
