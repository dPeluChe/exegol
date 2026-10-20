import { readdir, readFile } from "node:fs/promises";
import { basename, join, sep } from "node:path";
import {
  type FolderKind,
  fileManagerName,
  ideLabel,
  type LauncherFolder,
  linuxFileManagerName,
  type ProjectDetect,
} from "@exegol/shared";
import { detectIdes } from "../ide/detect";
import { execFileAsync } from "../lib/exec-file";
import { detectRunTargets, invalidateScriptsCache, type RunTarget } from "./scripts";

interface PackageJson {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/** A folder's kinds from its entries and package.json */
export function folderKinds(
  entries: string[],
  pkg: PackageJson | null,
  git: boolean,
): FolderKind[] {
  const kinds: FolderKind[] = [];
  if (git) kinds.push("git");
  if (pkg?.scripts && Object.keys(pkg.scripts).length > 0) kinds.push("node");
  if (entries.some((e) => e.endsWith(".xcworkspace") || e.endsWith(".xcodeproj"))) {
    kinds.push("xcode");
  }
  if (entries.includes("Package.swift")) kinds.push("swift");
  if (pkg?.dependencies?.expo || pkg?.devDependencies?.expo) {
    // Prebuilt: `expo prebuild` wrote the native projects; managed: Expo generates them
    kinds.push(
      entries.includes("ios") || entries.includes("android") ? "expo-prebuilt" : "expo-managed",
    );
  }
  return kinds;
}

let linuxFileManager: Promise<string> | null = null;

/** Linux: the default app for folders (`xdg-mime`), asked once per launch */
function detectFileManager(): Promise<string> {
  if (process.platform !== "linux") return Promise.resolve(fileManagerName(process.platform));
  linuxFileManager ??= execFileAsync("xdg-mime", ["query", "default", "inode/directory"], {
    timeout: 2000,
  })
    .then(({ stdout }) => fileManagerName("linux", linuxFileManagerName(stdout)))
    .catch(() => fileManagerName("linux"));
  return linuxFileManager;
}

/** The project's IDE, else Settings' default; null when neither is installed (or set) */
export function pickEditor(
  chosen: string | null | undefined,
  installed: ReadonlySet<string>,
  customPath: string | null | undefined,
): ProjectDetect["editor"] {
  if (!chosen) return null;
  if (chosen === "custom") {
    return customPath ? { id: "custom", label: basename(customPath) || ideLabel("custom") } : null;
  }
  return installed.has(chosen) ? { id: chosen, label: ideLabel(chosen) } : null;
}

const KINDS_TTL_MS = 60_000;
const kindsCache = new Map<string, { at: number; kinds: FolderKind[] }>();

async function kindsOf(target: RunTarget): Promise<FolderKind[]> {
  const cached = kindsCache.get(target.path);
  if (cached && Date.now() - cached.at < KINDS_TTL_MS) return cached.kinds;
  const entries = await readdir(target.path).catch(() => [] as string[]);
  const pkg = entries.includes("package.json")
    ? await readFile(join(target.path, "package.json"), "utf8")
        .then((raw) => JSON.parse(raw) as PackageJson)
        .catch(() => null)
    : null;
  const kinds = folderKinds(entries, pkg, target.git);
  kindsCache.set(target.path, { at: Date.now(), kinds });
  return kinds;
}

function invalidateKinds(projectPath: string): void {
  const prefix = projectPath.endsWith(sep) ? projectPath : projectPath + sep;
  for (const path of kindsCache.keys()) {
    if (path === projectPath || path.startsWith(prefix)) kindsCache.delete(path);
  }
}

export interface DetectInput {
  projectPath: string;
  /** Edit project's IDE, else Settings' default */
  ide: string | null | undefined;
  customIdePath: string | null | undefined;
}

/** T204: folders and their kind, the editor to offer and the file manager, for the launcher.
 *  Scripts and kinds are cached 60 s and IDEs 10 min; `fresh` (the Refresh button) drops them */
export async function detectProject(input: DetectInput, fresh = false): Promise<ProjectDetect> {
  if (fresh) {
    invalidateScriptsCache(input.projectPath);
    invalidateKinds(input.projectPath);
  }
  const [targets, ides, fileManager] = await Promise.all([
    detectRunTargets(input.projectPath),
    detectIdes(fresh),
    detectFileManager(),
  ]);
  const folders: LauncherFolder[] = await Promise.all(
    targets.map(async (t) => ({ ...t, kinds: await kindsOf(t) })),
  );
  return {
    folders,
    editor: pickEditor(input.ide, new Set<string>(ides.keys()), input.customIdePath),
    fileManager,
  };
}
