import { extname } from "node:path";

const MAC = [
  ".app",
  ".command",
  ".sh",
  ".bash",
  ".zsh",
  ".tool",
  ".terminal",
  ".workflow",
  ".action",
  ".scpt",
  ".applescript",
  ".pkg",
  ".mpkg",
  ".dmg",
  ".jar",
  ".py",
  ".rb",
  ".pl",
];

// The default handler runs these (Windows Script Host takes .js/.vbs, .reg merges into the registry)
const WINDOWS = [
  ".exe",
  ".com",
  ".bat",
  ".cmd",
  ".ps1",
  ".vbs",
  ".vbe",
  ".js",
  ".jse",
  ".wsf",
  ".wsh",
  ".hta",
  ".lnk",
  ".url",
  ".pif",
  ".msi",
  ".msp",
  ".scr",
  ".cpl",
  ".reg",
  ".appref-ms",
  ".jar",
  ".py",
];

const LINUX = [
  ".desktop",
  ".deb",
  ".rpm",
  ".appimage",
  ".run",
  ".sh",
  ".bash",
  ".zsh",
  ".fish",
  ".flatpakref",
  ".snap",
  ".jar",
  ".py",
  ".rb",
  ".pl",
];

const BY_PLATFORM: Partial<Record<NodeJS.Platform, ReadonlySet<string>>> = {
  darwin: new Set(MAC),
  win32: new Set(WINDOWS),
};
const OTHER = new Set(LINUX);

/** Opening these with the system's default app runs them: the Files viewer reveals them instead */
export function isRunnableFile(
  path: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return (BY_PLATFORM[platform] ?? OTHER).has(extname(path).toLowerCase());
}
