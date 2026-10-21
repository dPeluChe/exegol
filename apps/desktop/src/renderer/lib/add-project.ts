import type { FolderInspection } from "@exegol/shared";

export function folderName(folderPath: string): string {
  const segments = folderPath.replace(/\\/g, "/").split("/").filter(Boolean);
  return segments[segments.length - 1] ?? "Untitled";
}

export const isAbsoluteFolder = (p: string) => /^(\/|[A-Za-z]:[\\/])/.test(p);

/** What the Add Project dialog says about the picked folder before submit */
export type FolderNotice =
  | { kind: "existing"; id: string; name: string }
  | { kind: "missing" }
  | { kind: "notDirectory" }
  | { kind: "noGit" }
  | { kind: "subfolder"; toplevel: string };

export function folderNotice(info: FolderInspection | null | undefined): FolderNotice | null {
  if (!info) return null;
  if (info.existingProject) return { kind: "existing", ...info.existingProject };
  if (!info.exists) return { kind: "missing" };
  if (!info.isDirectory) return { kind: "notDirectory" };
  if (info.git === "none") return { kind: "noGit" };
  if (info.git === "subfolder" && info.toplevel)
    return { kind: "subfolder", toplevel: info.toplevel };
  return null;
}

/** The main process's message without Electron's "Error invoking remote method" wrapper */
export function ipcErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.replace(/^Error invoking remote method '[^']*': (?:\w*Error: )?/, "");
}
