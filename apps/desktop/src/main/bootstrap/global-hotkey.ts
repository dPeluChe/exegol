import { app, globalShortcut } from "electron";
import { logger } from "../lib/logger";

let registered: string | null = null;
let handler: (() => void) | null = null;

const PORTAL_FEATURE = "GlobalShortcutsPortal";

/** A comma-separated `enable-features` value with `feature` added once */
export function withFeature(existing: string, feature: string): string {
  const features = existing.split(",").filter(Boolean);
  return features.includes(feature) ? features.join(",") : [...features, feature].join(",");
}

/** A Wayland session, where only the desktop's GlobalShortcuts portal can bind a global key */
export function isWaylandSession(env: NodeJS.ProcessEnv): boolean {
  return env.XDG_SESSION_TYPE === "wayland" || !!env.WAYLAND_DISPLAY;
}

/** Before app ready. Under native Wayland, globalShortcut works only through the portal, which
 *  Chromium leaves off; on X11 the feature is unused. Merged: a second switch would replace it */
export function enableShortcutsPortal(): void {
  if (process.platform !== "linux") return;
  const current = app.commandLine.getSwitchValue("enable-features");
  app.commandLine.appendSwitch("enable-features", withFeature(current, PORTAL_FEATURE));
}

/** Re-registrable: settings.update calls this again when the user changes the accelerator. */
/** Returns whether `hotkey` is now registered. A failed one leaves the previous hotkey in place:
 *  unregistering first left the app with no hotkey at all */
export function registerGlobalHotkey(hotkey: string, onPress?: () => void): boolean {
  if (onPress) handler = onPress;
  if (!handler) return false;
  if (hotkey === registered) return true;
  const wayland = process.platform === "linux" && isWaylandSession(process.env);
  try {
    // register() throws on a malformed accelerator and returns false when another app owns it
    if (!globalShortcut.register(hotkey, handler)) {
      logger.warn(
        wayland
          ? `[Hotkey] ${hotkey} not registered: the desktop's GlobalShortcuts portal is missing or refused it`
          : `[Hotkey] ${hotkey} is taken by another app`,
      );
      return false;
    }
  } catch (err) {
    logger.warn(`[Hotkey] invalid accelerator ${hotkey}`, err);
    return false;
  }
  // The portal binds asynchronously and the desktop may ask first: true is a request, not a bind
  if (wayland) logger.info(`[Hotkey] ${hotkey} requested through the GlobalShortcuts portal`);
  if (registered) globalShortcut.unregister(registered);
  registered = hotkey;
  return true;
}
