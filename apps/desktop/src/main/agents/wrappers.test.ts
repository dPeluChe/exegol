import { describe, expect, it } from "vitest";
import {
  claudeGlobalHooks,
  codexGlobalHooks,
  formatLike,
  isExegolHook,
  notifyCommand,
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

/** The settings.json an earlier release left: third-party entries around Exegol's */
function legacySettings() {
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
    expect(isExegolHook(legacy("stop"), script)).toBe(true);
    expect(
      isExegolHook(
        { hooks: [{ type: "command", command: notifyCommand("stop", "global", script) }] },
        script,
      ),
    ).toBe(true);
    expect(isExegolHook(superset, script)).toBe(false);
    expect(
      isExegolHook(
        { hooks: [{ type: "command", command: "/Users/me/code/labs-exegol/scripts/lint.sh" }] },
        script,
      ),
    ).toBe(false);
    // Edited by hand or sharing the entry with another command: not ours to remove
    expect(
      isExegolHook(
        { hooks: [{ type: "command", command: `"${script}" stop && echo done` }] },
        script,
      ),
    ).toBe(false);
    expect(isExegolHook({ hooks: [...legacy("stop").hooks, ...superset.hooks] }, script)).toBe(
      false,
    );
  });
});

describe("notifyCommand", () => {
  // Outside Exegol the hook's own shell answers with builtins: no notify.sh process
  it("guards the global hook before anything runs, and exits 0 when skipped", () => {
    const cmd = notifyCommand("stop", "global", script);
    expect(cmd).toBe(
      `if [ -n "$EXEGOL_AGENT_ID" ] && [ -z "$EXEGOL_HOOKS_FILE" ] && [ -x "${script}" ]; then "${script}" stop; fi`,
    );
    expect(notifyCommand("stop", "agent", script)).toBe(
      `if [ -x "${script}" ]; then "${script}" stop; fi`,
    );
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
  it("keeps the file's indent and final newline", () => {
    expect(formatLike('{\n    "a": 1\n}\n', { a: 2 })).toBe('{\n    "a": 2\n}\n');
    expect(formatLike('{\n\t"a": 1\n}', { a: 2 })).toBe('{\n\t"a": 2\n}');
    expect(formatLike("", { a: 1 })).toBe('{\n  "a": 1\n}\n');
  });
});
