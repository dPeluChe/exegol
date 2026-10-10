/** T203: the iOS Simulator pane (macOS + Xcode + AXe) */

export interface SimDevice {
  udid: string;
  name: string;
  /** "iOS 26.3", from the runtime identifier */
  runtime: string;
  /** simctl's own words: "Booted", "Shutdown", "Booting", "Shutting Down" */
  state: string;
}

export interface SimulatorSupport {
  /** macOS with Xcode's `simctl` */
  simctl: boolean;
  /** AXe's path, null when missing (the pane shows the install command) */
  axe: string | null;
}

export const AXE_INSTALL_COMMAND = "brew install cameroncooke/axe/axe";

/** Screen size in points: what AXe's tap and swipe coordinates are in */
export interface SimScreenSize {
  width: number;
  height: number;
}

export type SimStreamEvent =
  | { paneId: string; state: "starting" | "live" | "paused" }
  | { paneId: string; state: "ended"; reason: string };

/** AXe types through a HID keyboard: US keys only */
export const SIM_TYPE_TEXT = /^[\x20-\x7E]{1,500}$/;

/** HID keycodes `axe key` takes for the keys `axe type` cannot send */
export const SIM_KEYCODES = { Enter: 40, Escape: 41, Backspace: 42, Tab: 43 } as const;
export type SimKey = keyof typeof SIM_KEYCODES;

export const SIM_BUTTONS = ["home", "lock", "side-button", "siri"] as const;
export type SimButton = (typeof SIM_BUTTONS)[number];
