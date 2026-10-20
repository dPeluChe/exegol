const LINUX_APPS: Record<string, string> = {
  nautilus: "Files",
  dolphin: "Dolphin",
  nemo: "Nemo",
  thunar: "Thunar",
  caja: "Caja",
  pcmanfm: "PCManFM",
  "pcmanfm-qt": "PCManFM-Qt",
  konqueror: "Konqueror",
};

/** `org.kde.dolphin.desktop` (xdg-mime's default for inode/directory) → "Dolphin"; null if unknown */
export function linuxFileManagerName(desktopId: string): string | null {
  const id = desktopId
    .trim()
    .toLowerCase()
    .replace(/\.desktop$/, "");
  return LINUX_APPS[id] ?? LINUX_APPS[id.split(".").pop() ?? ""] ?? null;
}

/** What the OS calls its file manager, for "Reveal in ..." labels. Linux: the detected one, else "Files" */
export function fileManagerName(platform: string, linuxDetected?: string | null): string {
  if (platform === "darwin") return "Finder";
  if (platform === "win32") return "File Explorer";
  return linuxDetected || "Files";
}
