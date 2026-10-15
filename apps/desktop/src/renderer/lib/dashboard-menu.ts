/** Which right-click items a Dashboard card offers; the components map each id to its action */

export type WatchMenuItem =
  | "go-to"
  | "copy"
  | "send-selection"
  | "resume"
  | "collapse"
  | "expand"
  | "fit-to-card"
  | "stop-fit"
  | "font-smaller"
  | "font-larger"
  | "float"
  | "unpin";

export interface WatchCardState {
  /** The session is running (a mirror shows it) */
  live: boolean;
  /** Full card, not a collapsed strip */
  expanded: boolean;
  /** Text selected in the mirror */
  hasSelection: boolean;
  /** The card sizes the session (cardFont set) */
  sizing: boolean;
  /** Its pane exists and is not already floating */
  canFloat: boolean;
}

export function watchCardMenu(s: WatchCardState): WatchMenuItem[][] {
  const mirror = s.live && s.expanded;
  const clipboard: WatchMenuItem[] = mirror && s.hasSelection ? ["copy", "send-selection"] : [];
  const sizing: WatchMenuItem[] = mirror
    ? [s.sizing ? "stop-fit" : "fit-to-card", "font-smaller", "font-larger"]
    : [];
  const sections: WatchMenuItem[][] = [
    ["go-to", ...(s.live ? [] : (["resume"] as const))],
    clipboard,
    [
      s.expanded ? "collapse" : "expand",
      ...sizing,
      ...(s.live && s.canFloat ? ["float" as const] : []),
    ],
    ["unpin"],
  ];
  return sections.filter((section) => section.length > 0);
}

export type GoneMenuItem = "resume" | "open-project" | "unpin";

/** A pin whose session ended with nothing continuing it: the card's own three buttons */
export function goneCardMenu(known: boolean): GoneMenuItem[][] {
  return known ? [["resume", "open-project"], ["unpin"]] : [["unpin"]];
}

export type FleetMenuItem =
  | "go-to"
  | "watch"
  | "unwatch"
  | "mute"
  | "unmute"
  | "suspend"
  | "resume"
  | "archive";

export interface FleetCardState {
  live: boolean;
  shell: boolean;
  watched: boolean;
  muted: boolean;
}

/** Live: Watch, Mute and Suspend as the terminal toolbar has them. Ended: Resume and Archive */
export function fleetCardMenu(s: FleetCardState): FleetMenuItem[][] {
  const pin: FleetMenuItem[] = s.watched ? ["unwatch"] : s.live ? ["watch"] : [];
  const lifecycle: FleetMenuItem[] = !s.live
    ? ["resume", "archive"]
    : s.shell
      ? []
      : [s.muted ? "unmute" : "mute", "suspend"];
  const sections: FleetMenuItem[][] = [["go-to", ...pin], lifecycle];
  return sections.filter((section) => section.length > 0);
}
