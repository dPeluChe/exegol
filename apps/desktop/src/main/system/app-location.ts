import { dirname } from "node:path";

/** The folder that moves with the app: the `.app` bundle on macOS, else the executable's folder
 *  (an AppImage mounts somewhere new on every launch) */
export function bundleRoot(execPath: string): string {
  const app = execPath.match(/^(.*?\.app)\//);
  return app?.[1] ?? dirname(execPath);
}

/** A DMG volume or a Gatekeeper translocation: the paths written from here break once it moves */
export function isTransientLocation(execPath: string): boolean {
  return execPath.startsWith("/Volumes/") || execPath.includes("/AppTranslocation/");
}

export interface Relocation {
  from: string;
  to: string;
}

/** The app moved since the last launch recorded `lastExecPath`; null on a first launch or none */
export function planRelocation(lastExecPath: string | null, execPath: string): Relocation | null {
  if (!lastExecPath) return null;
  const from = bundleRoot(lastExecPath);
  const to = bundleRoot(execPath);
  return from === to ? null : { from, to };
}

/** `value` with every path under `from` moved under `to` (strings anywhere inside, keys kept) */
export function swapRoot<T>(value: T, { from, to }: Relocation): T {
  if (typeof value === "string") return value.split(`${from}/`).join(`${to}/`) as T;
  if (Array.isArray(value)) return value.map((v) => swapRoot(v, { from, to })) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, swapRoot(v, { from, to })]),
    ) as T;
  }
  return value;
}

/** Offer the move to /Applications: a packaged macOS app running off a DMG or translocated */
export function shouldOfferMove(opts: {
  platform: string;
  packaged: boolean;
  execPath: string;
  inApplications: boolean;
}): boolean {
  return (
    opts.platform === "darwin" &&
    opts.packaged &&
    !opts.inApplications &&
    isTransientLocation(opts.execPath)
  );
}
