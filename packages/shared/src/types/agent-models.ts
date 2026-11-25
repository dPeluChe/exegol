/**
 * Flag that makes each CLI skip its own permission prompts. Single source of
 * truth: the settings toggle, the pipeline executor and the spawn modal all
 * read this. The two former copies had already drifted — crush's flag existed
 * in the pipeline but not in settings, so its toggle silently did nothing.
 * One token each (the toggle finds the flag by exact match). Checked against
 * each CLI's --help, 2026-09-24; codex dropped --full-auto.
 */
export const YOLO_FLAGS: Record<string, string> = {
  "claude-code": "--dangerously-skip-permissions",
  codex: "--dangerously-bypass-approvals-and-sandbox",
  gemini: "--yolo",
  agy: "--dangerously-skip-permissions",
  devin: "--permission-mode=dangerous",
  opencode: "--auto",
  amp: "--dangerously-allow-all",
  kilocode: "--auto",
  crush: "--yolo",
  "factory-droid": "--auto=high",
  aider: "--yes-always",
  goose: "--no-confirm",
  grok: "--always-approve",
  cursor: "--yolo",
};

/**
 * How each CLI takes a model for one session (--help, vendor docs and each binary's config schema,
 * 2026-10-08): a flag (`with`: args it needs alongside; `key`: a `-c key=value` override); an
 * environment variable; a JSON config variable merged over the value it already has; or droid's
 * `--settings` file, merged for that process only. amp picks its model through a mode. crush and
 * kiro have no per-session model (their config file is global), so the launcher shows no field.
 */
export type ModelLaunch =
  | { flag: string; with?: string[]; key?: string }
  | { env: string }
  | { jsonEnv: string; path: string[] }
  | { settingsFile: string[] };

export const MODEL_LAUNCH: Record<string, ModelLaunch> = {
  "claude-code": { flag: "--model" },
  codex: { flag: "--model" },
  gemini: { flag: "-m" },
  agy: { flag: "--model" },
  devin: { flag: "--model" },
  aider: { flag: "--model" },
  opencode: { flag: "-m" },
  kilocode: { flag: "-m" },
  amp: { flag: "-m" },
  goose: { env: "GOOSE_MODEL" },
  "factory-droid": { settingsFile: ["sessionDefaultSettings", "model"] },
  grok: { flag: "-m" },
  cursor: { flag: "--model" },
};

/** A second model a CLI takes for one session, for a narrower job than the main one */
export interface ModelRole {
  id: string;
  label: string;
  hint: string;
  launch: ModelLaunch;
  suggestions?: string[];
  /** Why a model cannot take this role next to that main model (the CLI would refuse it) */
  refuse?: (model: string, mainModel: string) => string | null;
}

/** Claude Code exits at launch on these; Fable also bills usage credits on subscriptions */
function refuseClaudeAdvisor(model: string, mainModel: string): string | null {
  const advisor = model.toLowerCase();
  if (advisor.includes("fable"))
    return "Fable as advisor bills usage credits, so it is not offered";
  if (advisor.includes("haiku")) return "Haiku cannot advise here: use opus or sonnet";
  if (mainModel.toLowerCase().includes("fable"))
    return "A Fable main model only takes a Fable advisor";
  return null;
}

/** The flag, variable or file a launch uses, as the launcher labels it */
export function launchHint(launch: ModelLaunch): string {
  if ("flag" in launch) return launch.key ? `${launch.flag} ${launch.key}` : launch.flag;
  if ("env" in launch) return launch.env;
  if ("jsonEnv" in launch) return launch.jsonEnv;
  return "--settings";
}

/** Advisor, subagent, planner or editor models each CLI accepts at launch (same sources as
 *  MODEL_LAUNCH). Claude's advisor never offers Fable: it bills usage credits on subscriptions */
export const MODEL_ROLES: Record<string, ModelRole[]> = {
  "claude-code": [
    {
      id: "advisor",
      label: "Advisor",
      hint: "Consulted at key decisions. Must rank at or above the main model; on a subscription it counts toward your plan's limits",
      launch: { flag: "--advisor" },
      suggestions: ["opus", "sonnet"],
      refuse: refuseClaudeAdvisor,
    },
    {
      id: "subagents",
      label: "Subagents",
      hint: "Default model for subagents and workflow agents that do not name their own",
      launch: { env: "CLAUDE_CODE_SUBAGENT_MODEL" },
      suggestions: ["haiku", "sonnet", "opus"],
    },
  ],
  codex: [
    {
      id: "subagents",
      label: "Subagents",
      hint: "Default model for the subagents it spawns",
      launch: { flag: "-c", key: "agents.default_subagent_model" },
    },
    {
      id: "review",
      label: "Review",
      hint: "Model /review uses",
      launch: { flag: "-c", key: "review_model" },
    },
  ],
  opencode: [
    {
      id: "plan",
      label: "Plan agent",
      hint: "Model of the built-in plan agent (Tab switches to it)",
      launch: { jsonEnv: "OPENCODE_CONFIG_CONTENT", path: ["agent", "plan", "model"] },
    },
    {
      id: "small",
      label: "Small tasks",
      hint: "Titles and other light work, as provider/model",
      launch: { jsonEnv: "OPENCODE_CONFIG_CONTENT", path: ["small_model"] },
    },
  ],
  kilocode: [
    {
      id: "plan",
      label: "Plan agent",
      hint: "Model of the built-in plan agent",
      launch: { jsonEnv: "KILO_CONFIG_CONTENT", path: ["agent", "plan", "model"] },
    },
    {
      id: "subagents",
      label: "Subagents",
      hint: "Default model for task-tool subagents, as provider/model",
      launch: { jsonEnv: "KILO_CONFIG_CONTENT", path: ["subagent_model"] },
    },
  ],
  aider: [
    {
      id: "editor",
      label: "Editor",
      hint: "Turns on architect mode: the main model plans, this one writes the edits",
      launch: { flag: "--editor-model", with: ["--architect"] },
    },
    {
      id: "weak",
      label: "Weak",
      hint: "Commit messages and chat summaries",
      launch: { flag: "--weak-model" },
    },
  ],
  goose: [
    {
      id: "subagents",
      label: "Subagents",
      hint: "Model for the subagents it delegates to",
      launch: { env: "GOOSE_SUBAGENT_MODEL" },
    },
  ],
  "factory-droid": [
    {
      id: "spec",
      label: "Spec mode",
      hint: "Model that writes the spec before the main model implements it",
      launch: { settingsFile: ["sessionDefaultSettings", "specModeModel"] },
    },
  ],
};

/** Why a role model is not passed: not a model id, or one the CLI would refuse */
export function roleModelProblem(
  cliType: string,
  roleId: string,
  model: string,
  mainModel: string,
): string | null {
  if (!MODEL_ID_PATTERN.test(model)) return "Not a model id";
  const role = MODEL_ROLES[cliType]?.find((r) => r.id === roleId);
  return role?.refuse?.(model, mainModel) ?? null;
}

/** The role models a launch actually passes: roles this CLI has, without a problem */
export function appliedModelRoles(
  cliType: string,
  roles: Record<string, string> | null | undefined,
  mainModel: string,
): Record<string, string> {
  const applied: Record<string, string> = {};
  for (const role of MODEL_ROLES[cliType] ?? []) {
    const value = roles?.[role.id];
    if (value && !roleModelProblem(cliType, role.id, value, mainModel)) applied[role.id] = value;
  }
  return applied;
}

/**
 * How each CLI takes an image from the clipboard (each one's source or docs, 2026-10-01):
 * "ctrl-v": it reads the clipboard itself on Ctrl+V and attaches it (Cmd+V never reaches a
 * terminal program on macOS, so Exegol sends Ctrl+V for it); "/paste": a command that does it
 * (typed, not sent: the user adds text and presses Enter). Absent (goose, shells): Exegol saves
 * the image to a file and types its path
 */
export const CLIPBOARD_IMAGE: Record<string, "ctrl-v" | "/paste"> = {
  "claude-code": "ctrl-v",
  codex: "ctrl-v",
  gemini: "ctrl-v",
  agy: "ctrl-v",
  devin: "ctrl-v",
  opencode: "ctrl-v",
  amp: "ctrl-v",
  kilocode: "ctrl-v",
  crush: "ctrl-v",
  "factory-droid": "ctrl-v",
  grok: "ctrl-v",
  aider: "/paste",
  kiro: "/paste",
};

/** Suggestions shipped with the app; CLIs that can list theirs add them (agents.listModels) */
export const MODEL_SUGGESTIONS: Record<string, string[]> = {
  "claude-code": ["sonnet", "opus", "haiku", "opusplan"],
  amp: ["smart", "rush", "free"],
};

/** Goes into the shell command unquoted: model ids only (letters, digits, . _ - : / @) */
export const MODEL_ID_PATTERN = /^[\w.:/@-]{1,100}$/;
