/** Per-CLI facts (sources for the commands in docs/TASK_COMPLETED/2610.md) */

/** A command for every OS, or per OS; a missing OS has no native install (the docs say how) */
type PerOs = string | { unix?: string; mac?: string; linux?: string; win?: string };

/** What Exegol knows about a CLI beyond its launch config (the provider registry): how to install
 *  and update it per OS, where its newest release is published, and the names its binary moved
 *  to. One table, read by the launcher, Doctor, preflight, CLI updates and Settings */
interface CliEntry {
  install: PerOs;
  /** Absent: the CLI has no update command, so re-running its installer updates it */
  update?: PerOs;
  docs: string;
  deprecated?: string;
  /** Its newest release, when the registry numbers match its `--version` (agy, devin, droid,
   *  kiro and goose have none we can read: they only get "restart to update") */
  latest?: { npm: string } | { pypi: string };
  /** Newer names of its binary (the provider's command is the first): Kilo Code 1.0 ships `kilo` */
  binaryAliases?: string[];
  /** The key that interrupts a turn and returns to the prompt (Steer) */
  interrupt?: string;
}

const CURL = (url: string, sh = "bash") => `curl -fsSL ${url} | ${sh}`;
const IRM = (url: string) => `irm ${url} | iex`;

/** Each vendor's recommended install and update per OS, from their install docs (2026-10-01,
 *  sources in docs/TASK_COMPLETED/2610.md). Re-check when a CLI changes how it ships */
export const CLI_CATALOG: Partial<Record<string, CliEntry>> = {
  "claude-code": {
    install: {
      unix: CURL("https://claude.ai/install.sh"),
      win: IRM("https://claude.ai/install.ps1"),
    },
    update: "claude update",
    docs: "https://code.claude.com/docs/en/setup",
    latest: { npm: "@anthropic-ai/claude-code" },
    interrupt: "\x1b",
  },
  codex: {
    install: {
      unix: CURL("https://chatgpt.com/codex/install.sh", "sh"),
      win: `powershell -ExecutionPolicy ByPass -c "${IRM("https://chatgpt.com/codex/install.ps1")}"`,
    },
    docs: "https://github.com/openai/codex",
    latest: { npm: "@openai/codex" },
    interrupt: "\x1b",
  },
  gemini: {
    install: "npm install -g @google/gemini-cli",
    update: "npm install -g @google/gemini-cli@latest",
    docs: "https://geminicli.com/docs/get-started/installation/",
    deprecated: "Replaced upstream by Antigravity CLI (agy) on 2026-06-18",
    latest: { npm: "@google/gemini-cli" },
  },
  agy: {
    install: {
      unix: CURL("https://antigravity.google/cli/install.sh"),
      win: IRM("https://antigravity.google/cli/install.ps1"),
    },
    docs: "https://antigravity.google/docs/cli/install/",
  },
  devin: {
    install: {
      unix: CURL("https://cli.devin.ai/install.sh"),
      win: IRM("https://static.devin.ai/cli/setup.ps1"),
    },
    docs: "https://docs.devin.ai/cli",
  },
  aider: {
    install: {
      unix: "curl -LsSf https://aider.chat/install.sh | sh",
      win: `powershell -ExecutionPolicy ByPass -c "${IRM("https://aider.chat/install.ps1")}"`,
    },
    update: "aider --upgrade",
    docs: "https://aider.chat/docs/install.html",
    latest: { pypi: "aider-chat" },
  },
  goose: {
    install: {
      unix: CURL("https://github.com/aaif-goose/goose/releases/download/stable/download_cli.sh"),
      win: 'Invoke-WebRequest -Uri "https://raw.githubusercontent.com/aaif-goose/goose/main/download_cli.ps1" -OutFile "download_cli.ps1"; .\\download_cli.ps1',
    },
    update: "goose update",
    docs: "https://goose-docs.ai/docs/getting-started/installation/",
  },
  opencode: {
    install: { unix: CURL("https://opencode.ai/install"), win: "scoop install opencode" },
    update: "opencode upgrade",
    docs: "https://opencode.ai/docs/",
    latest: { npm: "opencode-ai" },
  },
  // Windows only through WSL
  amp: {
    install: { unix: CURL("https://ampcode.com/install.sh") },
    update: "amp update",
    docs: "https://ampcode.com/docs/cli",
    latest: { npm: "@sourcegraph/amp" },
  },
  kiro: {
    install: {
      mac: CURL("https://cli.kiro.dev/install"),
      linux:
        "curl --proto '=https' --tlsv1.2 -sSf 'https://desktop-release.q.us-east-1.amazonaws.com/latest/kirocli-x86_64-linux.zip' -o kirocli.zip && unzip kirocli.zip && ./kirocli/install.sh",
      win: IRM("'https://cli.kiro.dev/install.ps1'"),
    },
    update: "kiro-cli update",
    docs: "https://kiro.dev/docs/cli/installation/",
  },
  kilocode: {
    install: "npm install -g @kilocode/cli",
    update: "kilo upgrade",
    docs: "https://kilo.ai/docs/code-with-ai/platforms/cli",
    latest: { npm: "@kilocode/cli" },
    binaryAliases: ["kilo"],
  },
  // No self-update: the package manager it came from updates it
  crush: {
    install: {
      mac: "brew install charmbracelet/tap/crush",
      linux: "npm install -g @charmland/crush",
      win: "winget install charmbracelet.crush",
    },
    update: {
      mac: "brew upgrade charmbracelet/tap/crush",
      linux: "npm install -g @charmland/crush@latest",
      win: "winget upgrade charmbracelet.crush",
    },
    docs: "https://github.com/charmbracelet/crush",
    latest: { npm: "@charmland/crush" },
  },
  "factory-droid": {
    install: {
      unix: CURL("https://app.factory.ai/cli", "sh"),
      win: IRM("https://app.factory.ai/cli/windows"),
    },
    update: "droid update",
    docs: "https://docs.factory.ai/droid-cli/quickstart",
  },
};

function forOs(cmd: PerOs | undefined, platform: NodeJS.Platform): string | null {
  if (cmd === undefined) return null;
  if (typeof cmd === "string") return cmd;
  if (platform === "win32") return cmd.win ?? null;
  if (platform === "darwin") return cmd.mac ?? cmd.unix ?? null;
  return cmd.linux ?? cmd.unix ?? null;
}

/** A CLI's install and update commands for this OS (null: no native way, see `docs`) */
export function cliSetupFor(cliType: string, platform: NodeJS.Platform = process.platform) {
  const setup = CLI_CATALOG[cliType];
  if (!setup) return null;
  const install = forOs(setup.install, platform);
  return {
    install,
    update: forOs(setup.update, platform) ?? install,
    docs: setup.docs,
    deprecated: setup.deprecated,
  };
}

export const interruptKeyOf = (cliType: string) => CLI_CATALOG[cliType]?.interrupt ?? null;

/** Where a CLI's newest release is published, if anywhere we can read */
export const latestSourceOf = (cliType: string) => CLI_CATALOG[cliType]?.latest;

/** Binary name → its newer names, for the commands spawn resolves (`kilocode` → `kilo`). The
 *  catalog keys them by provider id; a provider with aliases has command === id (tested) */
export const COMMAND_ALIASES: Record<string, string[]> = Object.fromEntries(
  Object.entries(CLI_CATALOG).flatMap(([id, e]) =>
    e?.binaryAliases ? [[id, e.binaryAliases]] : [],
  ),
);

/** A provider's binary and the names it moved to, in lookup order */
export function providerBinaries(command: string): string[] {
  return [command, ...(COMMAND_ALIASES[command] ?? [])];
}
