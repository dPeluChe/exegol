// Shell wrapper files for readiness marker injection.
// Creates zsh/bash wrapper configs that source user originals
// + inject a one-shot OSC-777 marker before the first prompt.

import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { logger } from "../lib/logger";
import bashrcBash from "./shell-integration/bashrc.bash?raw";
import profilePs1 from "./shell-integration/profile.ps1?raw";
import zlogin from "./shell-integration/zlogin.zsh?raw";
import zprofile from "./shell-integration/zprofile.zsh?raw";
import zshenv from "./shell-integration/zshenv.zsh?raw";
import zshrc from "./shell-integration/zshrc.zsh?raw";

const EXEGOL_DIR = join(homedir(), ".exegol");
const SHELL_DIR = join(EXEGOL_DIR, "shell");
const ZSH_DIR = join(SHELL_DIR, "zsh");
const BASH_DIR = join(SHELL_DIR, "bash");
const SHELL_INTEGRATION_DIR = join(EXEGOL_DIR, "shell-integration");

/** OSC-777 private-use marker — avoids conflicts with VS Code (133), iTerm2 (1337), Warp (9001) */
export const SHELL_READY_MARKER = "\x1b]777;exegol-shell-ready\x07";

/** Shells that support our readiness marker */
const SHELLS_WITH_MARKER = new Set(["zsh", "bash", "fish"]);

export function getZshWrapperDir(): string {
  return ZSH_DIR;
}

export function getBashRcfile(): string {
  return join(BASH_DIR, "rcfile");
}

/** T112: ZDOTDIR pointing at the OSC 7 + OSC 133 shell-integration scripts. */
export function getShellIntegrationZdotdir(): string {
  return SHELL_INTEGRATION_DIR;
}

/** T112: bash rcfile that emits OSC 7 + OSC 133 sequences. */
export function getShellIntegrationBashRcfile(): string {
  return join(SHELL_INTEGRATION_DIR, "bashrc.bash");
}

/** Check if a shell supports readiness markers */
export function shellSupportsMarker(shellPath: string): boolean {
  const name = shellPath.split("/").pop() ?? "";
  return SHELLS_WITH_MARKER.has(name);
}

/** Build fish --init-command for marker injection */
export function getFishInitCommand(): string {
  return `function _exegol_shell_ready --on-event fish_prompt; printf '\\033]777;exegol-shell-ready\\007'; functions -e _exegol_shell_ready; end`;
}

/** Create all shell wrapper files on disk. Idempotent — safe to call on every startup. */
export function ensureShellWrappers(): void {
  try {
    mkdirSync(ZSH_DIR, { recursive: true });
    mkdirSync(BASH_DIR, { recursive: true });

    // ── ZSH wrappers ──────────────────────────────────────────────────
    // ZDOTDIR is set to this directory; each file sources the user's original.

    writeFileSync(
      join(ZSH_DIR, ".zshenv"),
      `# Exegol zsh wrapper — sources user's original .zshenv
if [[ -n "$EXEGOL_ORIG_ZDOTDIR" ]] && [[ -f "$EXEGOL_ORIG_ZDOTDIR/.zshenv" ]]; then
  ZDOTDIR="$EXEGOL_ORIG_ZDOTDIR" source "$EXEGOL_ORIG_ZDOTDIR/.zshenv"
elif [[ -f "$HOME/.zshenv" ]]; then
  ZDOTDIR="$HOME" source "$HOME/.zshenv"
fi
`,
    );

    writeFileSync(
      join(ZSH_DIR, ".zprofile"),
      `# Exegol zsh wrapper — sources user's original .zprofile
if [[ -n "$EXEGOL_ORIG_ZDOTDIR" ]] && [[ -f "$EXEGOL_ORIG_ZDOTDIR/.zprofile" ]]; then
  source "$EXEGOL_ORIG_ZDOTDIR/.zprofile"
elif [[ -f "$HOME/.zprofile" ]]; then
  source "$HOME/.zprofile"
fi
`,
    );

    writeFileSync(
      join(ZSH_DIR, ".zshrc"),
      `# Exegol zsh wrapper — sources user's original .zshrc
if [[ -n "$EXEGOL_ORIG_ZDOTDIR" ]] && [[ -f "$EXEGOL_ORIG_ZDOTDIR/.zshrc" ]]; then
  source "$EXEGOL_ORIG_ZDOTDIR/.zshrc"
elif [[ -f "$HOME/.zshrc" ]]; then
  source "$HOME/.zshrc"
fi
`,
    );

    // .zlogin: sources user's original + adds one-shot shell-ready marker.
    // Uses precmd so it fires AFTER direnv/nvm/conda hooks complete,
    // right before the first prompt is displayed.
    writeFileSync(
      join(ZSH_DIR, ".zlogin"),
      `# Exegol zsh wrapper — sources user's original .zlogin + shell-ready marker
if [[ -n "$EXEGOL_ORIG_ZDOTDIR" ]] && [[ -f "$EXEGOL_ORIG_ZDOTDIR/.zlogin" ]]; then
  source "$EXEGOL_ORIG_ZDOTDIR/.zlogin"
elif [[ -f "$HOME/.zlogin" ]]; then
  source "$HOME/.zlogin"
fi
# One-shot marker: fires once before first prompt, then self-removes.
_exegol_shell_ready() {
  precmd_functions=(\${precmd_functions:#_exegol_shell_ready})
  printf '\\033]777;exegol-shell-ready\\007'
}
precmd_functions=(\${precmd_functions[@]} _exegol_shell_ready)
`,
    );

    // ── BASH wrapper ──────────────────────────────────────────────────
    // Used via --rcfile for interactive shells, or sourced for -ilc commands.

    writeFileSync(
      join(BASH_DIR, "rcfile"),
      `# Exegol bash wrapper — sources user's bashrc + shell-ready marker
if [ -f "$HOME/.bashrc" ]; then
  source "$HOME/.bashrc"
fi
# One-shot marker via PROMPT_COMMAND
_exegol_shell_ready() {
  printf '\\033]777;exegol-shell-ready\\007'
  if [[ "$(declare -p PROMPT_COMMAND 2>/dev/null)" == "declare -a"* ]]; then
    local -a _new=()
    for _cmd in "\${PROMPT_COMMAND[@]}"; do
      [[ "$_cmd" != "_exegol_shell_ready" ]] && _new+=("$_cmd")
    done
    PROMPT_COMMAND=("\${_new[@]}")
  else
    PROMPT_COMMAND="\${_exegol_orig_prompt_cmd}"
    unset _exegol_orig_prompt_cmd
  fi
  unset -f _exegol_shell_ready
}
_exegol_orig_prompt_cmd="$PROMPT_COMMAND"
if [[ "$(declare -p PROMPT_COMMAND 2>/dev/null)" == "declare -a"* ]]; then
  PROMPT_COMMAND=("_exegol_shell_ready" "\${PROMPT_COMMAND[@]}")
else
  PROMPT_COMMAND="_exegol_shell_ready;\${PROMPT_COMMAND}"
fi
`,
    );

    logger.info("[ShellWrappers] Shell wrapper files created/updated");
  } catch (err) {
    logger.error("[ShellWrappers] Failed to create shell wrappers:", err);
  }
}

/**
 * T112: write OSC 7 + OSC 133 shell-integration scripts to
 * ~/.exegol/shell-integration/. Idempotent — safe to call every startup.
 *
 * Lifted from Terax (terax-ai/src-tauri/src/modules/pty/scripts/*) with the
 * names rebranded and the existing OSC-777 "shell-ready" marker preserved
 * so pty-shell-ready.ts gating still works for plain shells.
 */
export function ensureShellIntegration(): void {
  try {
    mkdirSync(SHELL_INTEGRATION_DIR, { recursive: true });
    writeFileSync(join(SHELL_INTEGRATION_DIR, ".zshenv"), zshenv);
    writeFileSync(join(SHELL_INTEGRATION_DIR, ".zprofile"), zprofile);
    writeFileSync(join(SHELL_INTEGRATION_DIR, ".zlogin"), zlogin);
    writeFileSync(join(SHELL_INTEGRATION_DIR, ".zshrc"), zshrc);
    writeFileSync(join(SHELL_INTEGRATION_DIR, "bashrc.bash"), bashrcBash);
    writeFileSync(join(SHELL_INTEGRATION_DIR, "profile.ps1"), profilePs1);
    logger.info("[ShellIntegration] OSC 7 + OSC 133 scripts written");
  } catch (err) {
    logger.error("[ShellIntegration] Failed to materialize scripts:", err);
  }
}
