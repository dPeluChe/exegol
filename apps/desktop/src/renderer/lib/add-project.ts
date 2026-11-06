import { isWindowsPath, pathSegments } from "@exegol/shared";

export function folderName(folderPath: string): string {
  return pathSegments(folderPath).at(-1) ?? "Untitled";
}

export const isAbsoluteFolder = (p: string) => p.startsWith("/") || isWindowsPath(p);
