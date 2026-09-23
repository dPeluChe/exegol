import { globalShortcut } from "electron";
import { logger } from "../lib/logger";

let registered: string | null = null;
let handler: (() => void) | null = null;

/** Re-registrable: settings.update calls this again when the user changes the accelerator. */
export function registerGlobalHotkey(hotkey: string, onPress?: () => void): void {
  if (onPress) handler = onPress;
  if (!handler) return;
  if (registered) globalShortcut.unregister(registered);
  registered = null;
  try {
    // register() throws on a malformed accelerator and returns false when another app owns it
    if (globalShortcut.register(hotkey, handler)) registered = hotkey;
    else logger.warn(`[Hotkey] ${hotkey} is taken by another app`);
  } catch (err) {
    logger.warn(`[Hotkey] invalid accelerator ${hotkey}`, err);
  }
}
