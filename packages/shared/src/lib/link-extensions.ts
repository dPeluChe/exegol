/**
 * What a plain click on a terminal file link does, by extension. `system` and `peek` are the
 * only kinds main lets a default app open; anything unlisted (scripts, apps, .webloc/.url/.html
 * that run or redirect) is revealed in Finder instead.
 */
export type LinkFileKind = "system" | "peek" | "reveal";

const KINDS: Record<LinkFileKind, string[]> = {
  system: [
    "pdf",
    "doc",
    "docx",
    "xls",
    "xlsx",
    "ppt",
    "pptx",
    "odt",
    "ods",
    "odp",
    "rtf",
    "key",
    "numbers",
    "pages",
    "tiff",
    "heic",
    "mp3",
    "wav",
    "m4a",
    "aac",
    "flac",
    "mp4",
    "mov",
    "m4v",
    "webm",
  ],
  peek: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "txt", "md", "csv", "log", "json"],
  reveal: ["zip", "gz", "tgz", "tar", "dmg"],
};

const BY_EXT = new Map(
  Object.entries(KINDS).flatMap(([kind, exts]) => exts.map((e) => [e, kind as LinkFileKind])),
);

/** `undefined` for no extension or an unlisted one */
export function linkFileKind(path: string): LinkFileKind | undefined {
  const dot = path.lastIndexOf(".");
  return dot < 0 ? undefined : BY_EXT.get(path.slice(dot + 1).toLowerCase());
}
