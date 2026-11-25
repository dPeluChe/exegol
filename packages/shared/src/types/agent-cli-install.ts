/** A CLI's installed version against its newest release (Doctor's cliUpdates) */
export interface CliUpdateStatus {
  cliType: string;
  installed: string | null;
  /** When the installed binary was written (ms): a session started before it runs an older one */
  installedAt: number | null;
  latest: string | null;
  updateAvailable: boolean;
  /** Matches how the copy that runs (first on PATH) was installed */
  updateCommand: string | null;
  installMethod: CliInstallMethod | null;
  /** Why the command may not fit (install method not recognized) */
  updateNote: string | null;
}

export type CliInstallMethod =
  | "brew"
  | "brew-cask"
  | "npm"
  | "bun"
  | "pnpm"
  | "yarn"
  | "pipx"
  | "uv"
  | "standalone"
  | "unknown";

export const INSTALL_METHOD_LABEL: Record<CliInstallMethod, string> = {
  brew: "Homebrew",
  "brew-cask": "Homebrew cask",
  npm: "npm global",
  bun: "bun global",
  pnpm: "pnpm global",
  yarn: "yarn global",
  pipx: "pipx",
  uv: "uv tool",
  standalone: "official installer",
  unknown: "unknown install",
};

/** One copy of a CLI on PATH */
export interface CliInstallCopy {
  path: string;
  method: CliInstallMethod;
  /** Brew formula/cask or package name, read from the install path */
  pkg: string | null;
  version: string | null;
  updateCommand: string | null;
  uninstallCommand: string;
}

/** "npm global · v0.162.1", for Settings > CLIs and Doctor */
export const describeInstallCopy = (c: Pick<CliInstallCopy, "method" | "version">): string =>
  [INSTALL_METHOD_LABEL[c.method], c.version && `v${c.version}`].filter(Boolean).join(" · ");

/** Every copy of a CLI on PATH, in PATH order: the first one is what runs */
export interface CliInstallInfo {
  cliType: string;
  copies: CliInstallCopy[];
}

function versionParts(v: string | null | undefined): number[] | null {
  const m = v?.match(/\d+(?:\.\d+)*/);
  return m ? m[0].split(".").map(Number) : null;
}

/** a > b, comparing the numbers CLIs print: 2.1.286, 0.0.1768123456-gabc, 3000.11.3 */
export function isNewerVersion(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const pa = versionParts(a);
  const pb = versionParts(b);
  if (!pa || !pb) return false;
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return false;
}

/** A newer CLI than the one this session started with is installed. A session from before the
 *  version was recorded (0.5.10) has none: it is behind when the binary was written after it
 *  started (a minute of slack: launching right after an install is not "older") */
export function cliRestartNeeded(
  agent: { cliVersion?: string | null; startedAt?: number | null },
  status?: Pick<CliUpdateStatus, "installed" | "installedAt">,
): boolean {
  if (!status) return false;
  if (agent.cliVersion) return isNewerVersion(status.installed, agent.cliVersion);
  return (
    !!status.installedAt &&
    !!agent.startedAt &&
    status.installedAt > agent.startedAt * 1000 + 60_000
  );
}
