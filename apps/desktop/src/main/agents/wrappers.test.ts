import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  claudeGlobalHooks,
  codexGlobalHooks,
  formatLike,
  isExegolHook,
  notifyCommand,
  notifyScript,
  syncHooksFile,
  withExegolHooks,
} from "./wrappers";

const script = "/home/u/.exegol/hooks/notify.sh";
const legacy = (event: string) => ({
  hooks: [{ type: "command", command: `[ -x "${script}" ] && "${script}" ${event}` }],
});
const superset = {
  hooks: [
    {
      type: "command",
      command:
        '[ -n "$SUPERSET_HOME_DIR" ] && [ -x "$SUPERSET_HOME_DIR/hooks/notify.sh" ] && "$SUPERSET_HOME_DIR/hooks/notify.sh"',
    },
  ],
};

type Def = { matcher?: string; hooks: Record<string, unknown>[] };

/** The settings.json an earlier release left: third-party entries around Exegol's */
function legacySettings(): { model: string; hooks: Record<string, Def[]>; permissions: object } {
  return {
    model: "opus",
    hooks: {
      Stop: [superset, legacy("stop")],
      PostToolUse: [
        { matcher: "*", ...superset },
        { matcher: "*", ...legacy("tool_use") },
      ],
      UserPromptSubmit: [legacy("prompt_submit")],
      Notification: [
        { matcher: "permission_prompt", ...legacy("permission_needed") },
        { matcher: "idle_prompt", ...legacy("session_ready") },
      ],
      SessionStart: [superset, { matcher: "clear", ...legacy("session_ready") }],
    },
    permissions: { allow: [] },
  };
}

describe("isExegolHook", () => {
  it("matches only the exact commands Exegol wrote", () => {
    const one = (command: string) => ({ hooks: [{ type: "command", command }] });
    expect(isExegolHook(legacy("stop"), script)).toBe(true);
    expect(isExegolHook(one(notifyCommand("stop", "global", script)), script)).toBe(true);
    // The guarded form of the first version of this change
    expect(
      isExegolHook(
        one(
          `if [ -n "$EXEGOL_AGENT_ID" ] && [ -z "$EXEGOL_HOOKS_FILE" ] && [ -x "${script}" ]; then "${script}" stop; fi`,
        ),
        script,
      ),
    ).toBe(true);
    expect(isExegolHook(superset, script)).toBe(false);
    expect(isExegolHook(one("/Users/me/code/labs-exegol/scripts/lint.sh"), script)).toBe(false);
    // Edited by hand or sharing the entry with another command: not ours to remove
    expect(isExegolHook(one(`"${script}" stop && echo done`), script)).toBe(false);
    expect(isExegolHook({ hooks: [...legacy("stop").hooks, ...superset.hooks] }, script)).toBe(
      false,
    );
  });
});

describe("notifyCommand", () => {
  // Outside Exegol the hook's own shell answers with builtins: no notify.sh process
  it("guards the global hook in a form every shell runs", () => {
    expect(notifyCommand("stop", "global", script)).toBe(
      `[ -z "$EXEGOL_AGENT_ID" ] || [ -n "$EXEGOL_HOOKS_FILE" ] || [ ! -x "${script}" ] || "${script}" stop`,
    );
    expect(notifyCommand("stop", "agent", script)).toBe(
      `[ ! -x "${script}" ] || "${script}" stop agent`,
    );
  });

  it("runs notify.sh only for an Exegol session without its own file, exiting 0 otherwise", () => {
    const dir = mkdtempSync(join(tmpdir(), "exegol-notify-"));
    const fake = join(dir, "notify.sh");
    writeFileSync(fake, '#!/bin/sh\necho "ran $1"\n', { mode: 0o755 });
    const run = (env: Record<string, string>) =>
      execFileSync("sh", ["-c", notifyCommand("stop", "global", fake)], {
        env: { PATH: process.env.PATH ?? "", ...env },
        encoding: "utf-8",
      });
    expect(run({})).toBe("");
    expect(run({ EXEGOL_AGENT_ID: "a1" })).toBe("ran stop\n");
    expect(run({ EXEGOL_AGENT_ID: "a1", EXEGOL_HOOKS_FILE: "/x.json" })).toBe("");
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("notifyScript", () => {
  const event = (payload: string) => {
    const home = mkdtempSync(join(tmpdir(), "exegol-notify-home-"));
    const file = join(home, "notify.sh");
    writeFileSync(file, notifyScript(), { mode: 0o755 });
    execFileSync(file, ["tool_use", "agent"], {
      env: { PATH: process.env.PATH ?? "", HOME: home, EXEGOL_AGENT_ID: "a1" },
      input: payload,
    });
    const dir = join(home, ".exegol", "events");
    const [name] = readdirSync(dir);
    const parsed = JSON.parse(readFileSync(join(dir, name as string), "utf-8"));
    rmSync(home, { recursive: true, force: true });
    return parsed as { sessionId: string; cwd: string };
  };

  it("carries the session id and the top-level cwd, escapes kept valid", () => {
    const payload = JSON.stringify({
      session_id: "s-1",
      transcript_path: "/t.jsonl",
      cwd: '/w/Corp "BiT"/nexus-control',
      tool_input: { cwd: "/elsewhere" },
    });
    expect(event(payload)).toMatchObject({ sessionId: "s-1", cwd: '/w/Corp "BiT"/nexus-control' });
  });

  it("an empty cwd when the payload has none", () => {
    expect(event(JSON.stringify({ session_id: "s-2" })).cwd).toBe("");
  });
});

describe("withExegolHooks", () => {
  it("replaces the legacy entries exactly once and keeps third-party ones in place", () => {
    const { settings, removed, added } = withExegolHooks(
      legacySettings(),
      claudeGlobalHooks(script),
      script,
    );
    expect(removed).toBe(6);
    expect(added).toBe(6);
    const hooks = settings.hooks as Record<string, { hooks: { command: string }[] }[]>;
    expect(hooks.Stop?.[0]).toEqual(superset);
    expect(hooks.SessionStart?.[0]).toEqual(superset);
    const all = Object.values(hooks).flat();
    expect(all.filter((d) => d.hooks[0]?.command.startsWith("[ -x "))).toHaveLength(0);
    expect(all.filter((d) => d.hooks[0]?.command.includes("EXEGOL_AGENT_ID"))).toHaveLength(6);
    expect(Object.keys(settings)).toEqual(["model", "hooks", "permissions"]);
  });

  it("changes nothing on a second run", () => {
    const first = withExegolHooks(legacySettings(), claudeGlobalHooks(script), script);
    const second = withExegolHooks(first.settings, claudeGlobalHooks(script), script);
    expect(second.removed + second.added).toBe(0);
    expect(second.settings).toBe(first.settings);
  });

  it("leaves Exegol's entries where they are when a later hook follows them", () => {
    const first = withExegolHooks(legacySettings(), claudeGlobalHooks(script), script).settings;
    const hooks = first.hooks as Record<string, unknown[]>;
    hooks.Stop = [...(hooks.Stop ?? []), superset];
    expect(withExegolHooks(first, claudeGlobalHooks(script), script).added).toBe(0);
  });

  it("keeps keys a user added to an Exegol entry, and ignores them when comparing", () => {
    const settings = legacySettings();
    const stop = settings.hooks.Stop?.[1] as Def;
    settings.hooks.Stop = [superset, { ...stop, hooks: [{ ...stop.hooks[0], timeout: 9 }] }];
    const first = withExegolHooks(settings, claudeGlobalHooks(script), script).settings;
    const hooks = first.hooks as Record<string, Def[]>;
    expect(hooks.Stop?.[1]?.hooks[0]).toEqual({
      type: "command",
      command: notifyCommand("stop", "global", script),
      timeout: 9,
    });
    expect(withExegolHooks(first, claudeGlobalHooks(script), script).added).toBe(0);
  });

  // Dev and release side by side: an older build puts the unguarded form back, this one takes it
  it("takes the file back after an older build rewrote it", () => {
    const ours = withExegolHooks(legacySettings(), claudeGlobalHooks(script), script).settings;
    const older = withExegolHooks(ours, [], script).settings as { hooks: Record<string, Def[]> };
    older.hooks.Stop = [...(older.hooks.Stop ?? []), legacy("stop")];
    const back = withExegolHooks(older, claudeGlobalHooks(script), script);
    expect(back.removed).toBe(1);
    const stops = (back.settings.hooks as Record<string, Def[]>).Stop ?? [];
    expect(stops.filter((d) => isExegolHook(d as never, script))).toHaveLength(1);
  });

  it("skips an event whose value is not a list", () => {
    const { settings } = withExegolHooks(
      { hooks: { Stop: { odd: true } } },
      codexGlobalHooks(script),
      script,
    );
    expect((settings.hooks as Record<string, unknown>).Stop).toEqual({ odd: true });
  });

  it("uninstalls: only Exegol's entries go, emptied events are dropped", () => {
    const { settings, removed, added } = withExegolHooks(legacySettings(), [], script);
    expect([removed, added]).toEqual([6, 0]);
    expect(settings.hooks).toEqual({
      Stop: [superset],
      PostToolUse: [{ matcher: "*", ...superset }],
      SessionStart: [superset],
    });
  });

  it("adds to a file without hooks and leaves malformed hooks alone", () => {
    const fresh = withExegolHooks({}, codexGlobalHooks(script), script);
    expect(fresh.added).toBe(2);
    expect(Object.keys(fresh.settings.hooks as object)).toEqual(["SessionStart", "Stop"]);
    const odd = { hooks: "not an object" };
    expect(withExegolHooks(odd, codexGlobalHooks(script), script)).toEqual({
      settings: odd,
      removed: 0,
      added: 0,
    });
  });
});

describe("formatLike", () => {
  it("keeps the file's BOM, indent, line endings and final newline", () => {
    expect(formatLike('{\n    "a": 1\n}\n', { a: 2 })).toBe('{\n    "a": 2\n}\n');
    expect(formatLike('{\n\t"a": 1\n}', { a: 2 })).toBe('{\n\t"a": 2\n}');
    expect(formatLike("", { a: 1 })).toBe('{\n  "a": 1\n}\n');
    expect(formatLike('﻿{\r\n  "a": 1\r\n}\r\n', { a: "x\ny" })).toBe(
      '﻿{\r\n  "a": "x\\ny"\r\n}\r\n',
    );
  });
});

// Real files in a temp folder: never the user's ~/.claude or ~/.codex
describe("syncHooksFile", () => {
  let dir: string;
  const managed = () => claudeGlobalHooks(script);
  const legacyText = `${JSON.stringify(legacySettings(), null, 2)}\n`;

  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), "exegol-hooks-")));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes once, keeps the first backup, and does not write again", () => {
    const file = join(dir, "settings.json");
    writeFileSync(file, legacyText);
    expect(syncHooksFile(file, "settings", managed(), script)).toBe(true);
    const once = readFileSync(file, "utf-8");
    expect(syncHooksFile(file, "settings", managed(), script)).toBe(false);
    expect(readFileSync(file, "utf-8")).toBe(once);
    // A later change (an older build flipped it) never replaces the original backup
    writeFileSync(file, legacyText.replace('"opus"', '"sonnet"'));
    expect(syncHooksFile(file, "settings", managed(), script)).toBe(true);
    expect(readFileSync(join(dir, "settings.json.exegol-backup"), "utf-8")).toBe(legacyText);
    expect(readdirSync(dir).sort()).toEqual(["settings.json", "settings.json.exegol-backup"]);
  });

  it("writes through a symlink to the real file and keeps the link", () => {
    const real = join(dir, "dotfiles");
    mkdirSync(real);
    writeFileSync(join(real, "settings.json"), legacyText);
    const link = join(dir, "settings.json");
    symlinkSync(join(real, "settings.json"), link);
    expect(syncHooksFile(link, "settings", managed(), script)).toBe(true);
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readFileSync(join(real, "settings.json"), "utf-8")).toContain("EXEGOL_HOOKS_FILE");
    expect(existsSync(join(real, "settings.json.exegol-backup"))).toBe(true);
    expect(existsSync(join(dir, "settings.json.exegol-backup"))).toBe(false);
  });

  it("leaves a read-only file alone", () => {
    const file = join(dir, "settings.json");
    writeFileSync(file, legacyText, { mode: 0o444 });
    expect(syncHooksFile(file, "settings", managed(), script)).toBe(false);
    expect(readFileSync(file, "utf-8")).toBe(legacyText);
    expect(readdirSync(dir)).toEqual(["settings.json"]);
  });

  it("keeps a BOM and CRLF line endings", () => {
    const file = join(dir, "settings.json");
    writeFileSync(file, `﻿${legacyText.replace(/\n/g, "\r\n")}`);
    expect(syncHooksFile(file, "settings", managed(), script)).toBe(true);
    const out = readFileSync(file, "utf-8");
    expect(out.startsWith("﻿{\r\n")).toBe(true);
    expect(out.replace(/\r\n/g, "")).not.toContain("\n");
  });
});
