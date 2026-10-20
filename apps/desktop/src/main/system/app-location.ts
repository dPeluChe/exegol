import { dirname } from "node:path";

/** The folder that moves with the app: the `.app` bundle on macOS, else the executable's folder */
export function bundleRoot(execPath: string): string {
  const app = execPath.match(/^(.*?\.app)\//);
  return app?.[1] ?? dirname(execPath);
}

/** A launch as app-location.json records it; `appImage` is the AppImage runtime's APPIMAGE */
export interface AppLaunchRecord {
  execPath: string;
  appImage?: string;
}

/** What files that outlive a launch name: the .AppImage file itself (its mount changes on every
 *  launch, see node-launch.ts), else the bundle */
export function appRoot({ execPath, appImage }: AppLaunchRecord): string {
  return appImage || bundleRoot(execPath);
}

/** A DMG volume or a Gatekeeper translocation: the paths written from here break once it moves */
export function isTransientLocation(execPath: string): boolean {
  return execPath.startsWith("/Volumes/") || execPath.includes("/AppTranslocation/");
}

export interface Relocation {
  from: string;
  to: string;
}

/** The app moved since the `last` recorded launch; null on a first launch or none. Not across an
 *  AppImage and an installed copy (a path under one is no path under the other), which also skips
 *  an older record naming an AppImage mount: nothing written now points into a mount */
export function planRelocation(
  last: AppLaunchRecord | null,
  now: AppLaunchRecord,
): Relocation | null {
  if (!last || !last.appImage !== !now.appImage) return null;
  const from = appRoot(last);
  const to = appRoot(now);
  return from === to ? null : { from, to };
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `value` with every path under (or equal to) `from` moved to `to`, strings anywhere inside,
 *  keys kept. A name that only starts like it (Exegol.app2) stays */
export function swapRoot<T>(value: T, { from, to }: Relocation): T {
  if (typeof value === "string") {
    return value.replace(new RegExp(`${escapeRegExp(from)}(?![\\w.-])`, "g"), () => to) as T;
  }
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
