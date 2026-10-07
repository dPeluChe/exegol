import type { MicStatus } from "@exegol/shared";
import { shell, systemPreferences } from "electron";

const MAC_MIC_SETTINGS =
  "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone";

/** macOS and Windows report the OS permission; Linux has none to ask for */
export function micStatus(): MicStatus {
  if (process.platform !== "darwin" && process.platform !== "win32") return "granted";
  try {
    return systemPreferences.getMediaAccessStatus("microphone") as MicStatus;
  } catch {
    return "unknown";
  }
}

/** macOS shows its prompt once; afterwards only System Settings can change the answer */
export async function askMic(): Promise<MicStatus> {
  if (process.platform === "darwin" && micStatus() === "not-determined") {
    await systemPreferences.askForMediaAccess("microphone");
  }
  return micStatus();
}

export function openMicSettings(): void {
  if (process.platform === "darwin") void shell.openExternal(MAC_MIC_SETTINGS);
}
