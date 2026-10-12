import { readFile } from "node:fs/promises";
import type Database from "libsql";
import { listLiveAgentPids } from "../db/queries/agents";
import { execFileAsync } from "../lib/exec-file";
import { logger } from "../lib/logger";
import { loginShell } from "./spawn-env";

const LOCALE_VARS = ["LC_ALL", "LC_CTYPE", "LANG"] as const;
type LocaleEnv = Partial<Record<(typeof LOCALE_VARS)[number], string>>;
const isLocaleVar = (name: string): name is keyof LocaleEnv =>
  (LOCALE_VARS as readonly string[]).includes(name);
const PS_LOCALE = new RegExp(`\\s(${LOCALE_VARS.join("|")})=(\\S*)`, "g");

/** The encoding a process uses: LC_ALL wins over LC_CTYPE over LANG, the C rules */
export function hasUtf8Locale(env: LocaleEnv): boolean {
  const effective = env.LC_ALL || env.LC_CTYPE || env.LANG || "";
  return /utf-?8/i.test(effective);
}

/** `ps -wwE -o pid=,command=` lines: pid, the command, then the environment as NAME=value */
export function localesFromPs(text: string): Map<number, LocaleEnv> {
  const out = new Map<number, LocaleEnv>();
  for (const line of text.split("\n")) {
    const pid = Number(line.trim().split(/\s/, 1)[0]);
    if (!pid) continue;
    const env: LocaleEnv = {};
    for (const m of line.matchAll(PS_LOCALE)) {
      env[m[1] as keyof LocaleEnv] = m[2];
    }
    out.set(pid, env);
  }
  return out;
}

/** /proc/<pid>/environ: NUL-separated NAME=value */
export function localeFromEnviron(raw: string): LocaleEnv {
  const env: LocaleEnv = {};
  for (const entry of raw.split("\0")) {
    const eq = entry.indexOf("=");
    const name = entry.slice(0, eq);
    if (isLocaleVar(name)) env[name] = entry.slice(eq + 1);
  }
  return env;
}

/** Each pid's starting locale; a pid that is gone or unreadable is left out */
async function readLocales(pids: number[]): Promise<Map<number, LocaleEnv>> {
  if (process.platform === "linux") {
    const out = new Map<number, LocaleEnv>();
    await Promise.all(
      pids.map((pid) =>
        readFile(`/proc/${pid}/environ`, "utf8")
          .then((raw) => out.set(pid, localeFromEnviron(raw)))
          .catch(() => {}),
      ),
    );
    return out;
  }
  // ps exits 1 when one pid is gone: the rest are still on stdout
  const { stdout } = await execFileAsync(
    "ps",
    ["-wwE", "-o", "pid=,command=", "-p", pids.join(",")],
    {
      maxBuffer: 8 * 1024 * 1024,
    },
  ).catch((err: { stdout?: string }) => ({ stdout: err.stdout ?? "" }));
  return localesFromPs(stdout);
}

let shellSetsUtf8: Promise<boolean> | null = null;
let lastLogged = 0;

/** A locale exported in .zshrc/.zprofile reaches every command those sessions run, whatever their
 *  starting environment said. Read once */
function loginShellSetsUtf8(): Promise<boolean> {
  shellSetsUtf8 ??= execFileAsync(
    loginShell(),
    ["-ilc", 'printf "%s|%s|%s" "$LC_ALL" "$LC_CTYPE" "$LANG"'],
    { timeout: 10_000, env: { ...process.env, LANG: "", LC_ALL: "", LC_CTYPE: "" } },
  )
    .then(({ stdout }) => {
      const [LC_ALL, LC_CTYPE, LANG] = stdout.trim().split("|");
      return hasUtf8Locale({ LC_ALL, LC_CTYPE, LANG });
    })
    .catch(() => false);
  return shellSetsUtf8;
}

/** Live sessions whose process started without a UTF-8 locale (begun before Exegol set one):
 *  CocoaPods refuses to run there and pbcopy stores Mac Roman. Restarting them is the only fix */
export async function sessionsWithoutUtf8(db: Database.Database): Promise<string[]> {
  if (process.platform === "win32") return [];
  const rows = listLiveAgentPids(db);
  if (rows.length === 0) return [];
  const [locales, shellUtf8] = await Promise.all([
    readLocales(rows.map((r) => r.pid)),
    loginShellSetsUtf8(),
  ]);
  if (shellUtf8) return [];
  const missing = rows.filter((r) => {
    const env = locales.get(r.pid);
    return env && !hasUtf8Locale(env);
  });
  if (missing.length !== lastLogged && missing.length > 0) {
    logger.info(`[Locale] ${missing.length} of ${rows.length} live sessions started without UTF-8`);
  }
  lastLogged = missing.length;
  return missing.map((r) => r.id);
}
