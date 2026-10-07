import type { IdeInfo } from "@exegol/shared";

type IdeId = IdeInfo["id"];

/** How a launcher takes "this file, at this line" */
export type LineStyle = "goto" | "suffix" | "jetbrains" | "nova" | "vim";

export interface IdeLaunch {
  /** CLI names, preferred first */
  commands: string[];
  line: LineStyle;
  macBundleIds?: string[];
  /** The CLI inside the .app, used when none is on PATH */
  macBundleCli?: string;
  /** .desktop file name prefixes (lowercase) */
  linuxDesktop?: string[];
  /** Home-relative dirs where its CLI lives off PATH */
  extraDirs?: string[];
}

const VSCODE_BIN = "Contents/Resources/app/bin";
const TOOLBOX_SCRIPTS = [
  "Library/Application Support/JetBrains/Toolbox/scripts",
  ".local/share/JetBrains/Toolbox/scripts",
];

/** Sources in docs/TASK_COMPLETED/2610.md (2026-10-07). VS Code forks take `--goto file:line`,
 *  Zed and Sublime `file:line`, JetBrains `--line N file`, Nova `file -l N`, vim `+N file` */
export const IDE_LAUNCH: Record<IdeId, IdeLaunch> = {
  vscode: {
    commands: ["code"],
    line: "goto",
    macBundleIds: ["com.microsoft.VSCode"],
    macBundleCli: `${VSCODE_BIN}/code`,
    linuxDesktop: ["code.desktop", "com.visualstudio.code"],
  },
  "vscode-insiders": {
    commands: ["code-insiders"],
    line: "goto",
    macBundleIds: ["com.microsoft.VSCodeInsiders"],
    macBundleCli: `${VSCODE_BIN}/code-insiders`,
    linuxDesktop: ["code-insiders"],
  },
  cursor: {
    commands: ["cursor"],
    line: "goto",
    macBundleIds: ["com.todesktop.230313mzl4w4u92"],
    macBundleCli: `${VSCODE_BIN}/cursor`,
    linuxDesktop: ["cursor"],
  },
  // Devin Desktop, formerly Windsurf: same bundle id, `devin-desktop` replaced `windsurf`/`surf`
  windsurf: {
    commands: ["devin-desktop", "windsurf"],
    line: "goto",
    macBundleIds: ["com.exafunction.windsurf"],
    macBundleCli: `${VSCODE_BIN}/devin-desktop`,
    linuxDesktop: ["devin", "windsurf"],
    extraDirs: [".codeium/windsurf/bin"],
  },
  zed: {
    commands: ["zed", "zeditor"],
    line: "suffix",
    macBundleIds: ["dev.zed.Zed"],
    macBundleCli: "Contents/MacOS/cli",
    linuxDesktop: ["dev.zed.zed", "zed"],
  },
  antigravity: {
    commands: ["antigravity-ide"],
    line: "goto",
    macBundleIds: ["com.google.antigravity-ide"],
    macBundleCli: `${VSCODE_BIN}/antigravity-ide`,
    linuxDesktop: ["antigravity-ide"],
  },
  sublime: {
    commands: ["subl"],
    line: "suffix",
    macBundleIds: ["com.sublimetext.4"],
    macBundleCli: "Contents/SharedSupport/bin/subl",
    linuxDesktop: ["sublime_text", "com.sublimetext"],
  },
  nova: { commands: ["nova"], line: "nova", macBundleIds: ["com.panic.Nova"] },
  idea: {
    commands: ["idea"],
    line: "jetbrains",
    macBundleIds: ["com.jetbrains.intellij", "com.jetbrains.intellij.ce"],
    linuxDesktop: ["jetbrains-idea", "intellij-idea", "com.jetbrains.intellij"],
    extraDirs: TOOLBOX_SCRIPTS,
  },
  webstorm: {
    commands: ["webstorm"],
    line: "jetbrains",
    macBundleIds: ["com.jetbrains.WebStorm"],
    linuxDesktop: ["jetbrains-webstorm", "webstorm", "com.jetbrains.webstorm"],
    extraDirs: TOOLBOX_SCRIPTS,
  },
  pycharm: {
    commands: ["pycharm"],
    line: "jetbrains",
    macBundleIds: ["com.jetbrains.pycharm", "com.jetbrains.pycharm.ce"],
    linuxDesktop: ["jetbrains-pycharm", "pycharm", "com.jetbrains.pycharm"],
    extraDirs: TOOLBOX_SCRIPTS,
  },
  goland: {
    commands: ["goland"],
    line: "jetbrains",
    macBundleIds: ["com.jetbrains.goland"],
    linuxDesktop: ["jetbrains-goland", "goland", "com.jetbrains.goland"],
    extraDirs: TOOLBOX_SCRIPTS,
  },
  rustrover: {
    commands: ["rustrover"],
    line: "jetbrains",
    macBundleIds: ["com.jetbrains.rustrover"],
    linuxDesktop: ["jetbrains-rustrover", "rustrover", "com.jetbrains.rustrover"],
    extraDirs: TOOLBOX_SCRIPTS,
  },
  neovim: { commands: ["nvim"], line: "vim" },
  vim: { commands: ["vim"], line: "vim" },
};

/** The arguments after the launcher that open `path`, at `line` when given */
export function targetArgs(style: LineStyle, path: string, line?: number): string[] {
  if (!line) return [path];
  switch (style) {
    case "goto":
      return ["--goto", `${path}:${line}`];
    case "suffix":
      return [`${path}:${line}`];
    case "jetbrains":
      return ["--line", String(line), path];
    case "nova":
      return [path, "-l", String(line)];
    case "vim":
      return [`+${line}`, path];
  }
}

/** The IDEs whose bundle ids are among the installed apps', with the .app that has each. The
 *  first app wins: /Applications is listed first, and Devin.app sorts before a leftover
 *  Windsurf.app (same bundle id) */
export function matchBundles(apps: { path: string; bundleId: string }[]): Map<IdeId, string> {
  const byId = new Map<string, string>();
  for (const a of apps) {
    const key = a.bundleId.toLowerCase();
    if (!byId.has(key)) byId.set(key, a.path);
  }
  const found = new Map<IdeId, string>();
  for (const [id, launch] of Object.entries(IDE_LAUNCH) as [IdeId, IdeLaunch][]) {
    const app = launch.macBundleIds?.map((b) => byId.get(b.toLowerCase())).find(Boolean);
    if (app) found.set(id, app);
  }
  return found;
}

/** The IDEs that have a .desktop file among `files` (base names), with that file */
export function matchDesktopFiles(files: string[]): Map<IdeId, string> {
  const found = new Map<IdeId, string>();
  for (const [id, launch] of Object.entries(IDE_LAUNCH) as [IdeId, IdeLaunch][]) {
    const file = files.find((f) => {
      const lower = f.toLowerCase();
      return (
        lower.endsWith(".desktop") &&
        launch.linuxDesktop?.some((prefix) => lower.startsWith(prefix))
      );
    });
    if (file) found.set(id, file);
  }
  return found;
}

/** A .desktop `Exec=` line as argv, field codes (%f, %U...) dropped */
export function parseDesktopExec(content: string): string[] | null {
  const line = content
    .split("\n")
    .find((l) => l.startsWith("Exec="))
    ?.slice(5)
    .trim();
  if (!line) return null;
  const argv = (line.match(/"[^"]*"|\S+/g) ?? [])
    .map((t) => (t.startsWith('"') ? t.slice(1, -1) : t))
    .filter((t) => !/^%[a-zA-Z]$/.test(t));
  return argv.length ? argv : null;
}

/** CFBundleIdentifier from an XML Info.plist */
export function plistBundleId(xml: string): string | null {
  return xml.match(/<key>CFBundleIdentifier<\/key>\s*<string>([^<]+)<\/string>/)?.[1] ?? null;
}
