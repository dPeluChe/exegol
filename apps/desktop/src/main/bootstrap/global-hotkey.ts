import { globalShortcut } from "electron";
import { logger } from "../lib/logger";

let registered: string | null = null;
let handler: (() => void) | null = null;

/** Re-registrable: settings.update calls this again when the user changes the accelerator. */
/** Returns whether `hotkey` is now registered. A failed one leaves the previous hotkey in place:
 *  unregistering first left the app with no hotkey at all */
export function registerGlobalHotkey(hotkey: string, onPress?: () => void): boolean {
  if (onPress) handler = onPress;
  if (!handler) return false;
  if (hotkey === registered) return true;
  try {
    // register() throws on a malformed accelerator and returns false when another app owns it
    if (!globalShortcut.register(hotkey, handler)) {
      logger.warn(`[Hotkey] ${hotkey} is taken by another app`);
      return false;
    }
  } catch (err) {
    logger.warn(`[Hotkey] invalid accelerator ${hotkey}`, err);
    return false;
  }
  if (registered) globalShortcut.unregister(registered);
  registered = hotkey;
  return true;
}
