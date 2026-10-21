export function folderName(folderPath: string): string {
  const segments = folderPath.replace(/\\/g, "/").split("/").filter(Boolean);
  return segments[segments.length - 1] ?? "Untitled";
}

export const isAbsoluteFolder = (p: string) => /^(\/|[A-Za-z]:[\\/])/.test(p);
