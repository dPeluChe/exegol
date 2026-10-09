import type { CliInstallMethod } from "@exegol/shared";
import { CLI_CATALOG, cliSetupFor } from "./cli-catalog";

export interface ClassifiedInstall {
  method: CliInstallMethod;
  /** The brew formula/cask, npm/pypi package, as the path names it */
  pkg: string | null;
}

const NPM_PKG = "(@[^/]+/[^/]+|[^/@][^/]*)";

/** Package managers first: their store paths say the package name. Standalone last, since
 *  official installers drop into home dirs a package manager could also use */
const RULES: { re: RegExp; method: CliInstallMethod }[] = [
  { re: /\/Caskroom\/([^/]+)\//, method: "brew-cask" },
  { re: /\/Cellar\/([^/]+)\//, method: "brew" },
  { re: new RegExp(`/\\.bun/install/global/node_modules/${NPM_PKG}/`), method: "bun" },
  {
    re: new RegExp(`/pnpm/global/[^/]+/(?:\\.pnpm/[^/]+/)?node_modules/${NPM_PKG}/`),
    method: "pnpm",
  },
  { re: new RegExp(`/yarn/global/node_modules/${NPM_PKG}/`), method: "yarn" },
  { re: new RegExp(`/lib/node_modules/${NPM_PKG}/`), method: "npm" },
  { re: /\/pipx\/venvs\/([^/]+)\//, method: "pipx" },
  { re: /\/uv\/tools\/([^/]+)\//, method: "uv" },
];

const norm = (p: string) => p.replace(/\\/g, "/");

/** How one copy on PATH was installed, from where its link points (`realPath`) and where it sits
 *  on PATH (`path`). Pure: the paths come from `which -a` + realpath */
export function classifyInstall(
  cliType: string,
  path: string,
  realPath: string,
  home: string,
): ClassifiedInstall {
  const real = norm(realPath);
  for (const { re, method } of RULES) {
    const m = real.match(re);
    if (m?.[1]) return { method, pkg: m[1] };
  }
  const onPath = norm(path);
  // Windows npm shims (%APPDATA%\npm\codex.cmd) do not link into node_modules
  const npm = npmPackageOf(cliType);
  if (npm && /\/AppData\/Roaming\/npm\//i.test(onPath)) return { method: "npm", pkg: npm };
  const h = norm(home).replace(/\/$/, "");
  const markers = CLI_CATALOG[cliType]?.standalone ?? [];
  if (markers.some((m) => real.startsWith(`${h}/${m}`) || onPath.startsWith(`${h}/${m}`))) {
    return { method: "standalone", pkg: null };
  }
  return { method: "unknown", pkg: null };
}

export const npmPackageOf = (cliType: string): string | null => {
  const latest = CLI_CATALOG[cliType]?.latest;
  return latest && "npm" in latest ? latest.npm : null;
};

const q = (p: string) => (/^[\w./~@+-]+$/.test(p) ? p : `'${p.replace(/'/g, "'\\''")}'`);

/** The command that updates THIS copy: updating another one leaves the running copy old */
export function updateCommandFor(
  cliType: string,
  install: ClassifiedInstall,
  platform: NodeJS.Platform = process.platform,
): { command: string | null; note: string | null } {
  const { method, pkg } = install;
  if (pkg) {
    switch (method) {
      case "brew":
        return { command: `brew upgrade ${pkg}`, note: null };
      case "brew-cask":
        return { command: `brew upgrade --cask ${pkg}`, note: null };
      case "npm":
        return { command: `npm install -g ${pkg}@latest`, note: null };
      case "bun":
        return { command: `bun add -g ${pkg}@latest`, note: null };
      case "pnpm":
        return { command: `pnpm add -g ${pkg}@latest`, note: null };
      case "yarn":
        return { command: `yarn global add ${pkg}@latest`, note: null };
      case "pipx":
        return { command: `pipx upgrade ${pkg}`, note: null };
      case "uv":
        return { command: `uv tool upgrade ${pkg}`, note: null };
    }
  }
  const fallback = cliSetupFor(cliType, platform)?.update ?? null;
  if (method === "standalone") return { command: fallback, note: null };
  return {
    command: fallback,
    note: fallback ? "Install method not recognized: this is the vendor's default update" : null,
  };
}

/** The command that removes this copy (shown, never run) */
export function uninstallCommandFor(install: ClassifiedInstall, path: string): string {
  const { method, pkg } = install;
  if (pkg) {
    switch (method) {
      case "brew":
        return `brew uninstall ${pkg}`;
      case "brew-cask":
        return `brew uninstall --cask ${pkg}`;
      case "npm":
        return `npm uninstall -g ${pkg}`;
      case "bun":
        return `bun remove -g ${pkg}`;
      case "pnpm":
        return `pnpm remove -g ${pkg}`;
      case "yarn":
        return `yarn global remove ${pkg}`;
      case "pipx":
        return `pipx uninstall ${pkg}`;
      case "uv":
        return `uv tool uninstall ${pkg}`;
    }
  }
  return `rm ${q(path)}`;
}

/** The session's CLI is another version after it exited: it updated itself (codex: "Update ran
 *  successfully! Please restart Codex.") */
export function selfUpdatedVersion(
  recorded: string | null | undefined,
  current: string | null | undefined,
): string | null {
  return recorded && current && recorded !== current ? current : null;
}
