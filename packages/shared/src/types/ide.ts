/** Every IDE Exegol can open, in display order. "windsurf" stays the id of Devin Desktop (the
 *  same app, renamed 2026-06-02) so a saved setting keeps working */
export const IDE_IDS = [
  "vscode",
  "vscode-insiders",
  "cursor",
  "windsurf",
  "zed",
  "antigravity",
  "sublime",
  "nova",
  "idea",
  "webstorm",
  "pycharm",
  "goland",
  "rustrover",
  "neovim",
  "vim",
  "custom",
] as const;

export type IdeType = (typeof IDE_IDS)[number];

export interface IdeInfo {
  id: Exclude<IdeType, "custom">;
  label: string;
  /** A former name, shown under the label */
  formerly?: string;
  /** AgentIcon id; without an official mark the glyph shows instead */
  icon: string;
  glyph: string;
  color: string;
  download: string;
  /** Opens in an Exegol terminal tab, not its own window */
  terminal?: boolean;
}

/** Sources (2026-10-07): each vendor's download page; Devin Desktop at docs.devin.ai/desktop */
export const IDE_INFO: IdeInfo[] = [
  {
    id: "vscode",
    label: "VS Code",
    icon: "vscode",
    glyph: "VS",
    color: "#007ACC",
    download: "https://code.visualstudio.com/download",
  },
  {
    id: "vscode-insiders",
    label: "VS Code Insiders",
    icon: "vscode-insiders",
    glyph: "VI",
    color: "#24BFA5",
    download: "https://code.visualstudio.com/insiders/",
  },
  {
    id: "cursor",
    label: "Cursor",
    icon: "cursor",
    glyph: "Cu",
    color: "#000000",
    download: "https://cursor.com/download",
  },
  {
    id: "windsurf",
    label: "Devin Desktop",
    formerly: "Windsurf",
    icon: "devin-desktop",
    glyph: "De",
    color: "#000000",
    download: "https://devin.ai/desktop",
  },
  {
    id: "zed",
    label: "Zed",
    icon: "zed",
    glyph: "Ze",
    color: "#084CCF",
    download: "https://zed.dev/download",
  },
  {
    id: "antigravity",
    label: "Antigravity IDE",
    icon: "agy",
    glyph: "Ag",
    color: "#4285F4",
    download: "https://antigravity.google/download",
  },
  {
    id: "sublime",
    label: "Sublime Text",
    icon: "sublime",
    glyph: "ST",
    color: "#FF9800",
    download: "https://www.sublimetext.com/download",
  },
  {
    id: "nova",
    label: "Nova",
    icon: "nova",
    glyph: "No",
    color: "#5B4FE9",
    download: "https://nova.app/",
  },
  {
    id: "idea",
    label: "IntelliJ IDEA",
    icon: "idea",
    glyph: "IJ",
    color: "#FE315D",
    download: "https://www.jetbrains.com/idea/download/",
  },
  {
    id: "webstorm",
    label: "WebStorm",
    icon: "webstorm",
    glyph: "WS",
    color: "#07C3F2",
    download: "https://www.jetbrains.com/webstorm/download/",
  },
  {
    id: "pycharm",
    label: "PyCharm",
    icon: "pycharm",
    glyph: "PC",
    color: "#21D789",
    download: "https://www.jetbrains.com/pycharm/download/",
  },
  {
    id: "goland",
    label: "GoLand",
    icon: "goland",
    glyph: "GL",
    color: "#0D7BF7",
    download: "https://www.jetbrains.com/go/download/",
  },
  {
    id: "rustrover",
    label: "RustRover",
    icon: "rustrover",
    glyph: "RR",
    color: "#FE6A2C",
    download: "https://www.jetbrains.com/rust/download/",
  },
  {
    id: "neovim",
    label: "Neovim",
    icon: "neovim",
    glyph: "nv",
    color: "#57A143",
    download: "https://neovim.io/",
    terminal: true,
  },
  {
    id: "vim",
    label: "Vim",
    icon: "vim",
    glyph: "vi",
    color: "#019733",
    download: "https://www.vim.org/download.php",
    terminal: true,
  },
];

export interface DetectedIde extends IdeInfo {
  installed: boolean;
}

export function ideLabel(id: string): string {
  if (id === "custom") return "Custom";
  return IDE_INFO.find((i) => i.id === id)?.label ?? id;
}
