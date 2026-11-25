import { getProjectState } from "../../stores/workspace";
import { layoutHasPane } from "../../stores/workspace/helpers";
import {
  CANVAS_ONLY_CLI_TYPES,
  DARK_BLACK_TERMINAL_THEME,
  DARK_TERMINAL_THEME,
  LIGHT_TERMINAL_THEME,
  type TerminalInstanceProps,
} from "./terminal-types";
import { webglBudget } from "./webgl-budget";

/** Sessions this renderer has mounted a live view of (pane or mirror): the first mount kicks an alt screen */
export const mountedSessions = new Set<string>();
/** The grid each session's pane last fitted at, for the next mount to start from */
export const lastGrids = new Map<string, { cols: number; rows: number }>();

export function resolveTerminalTheme(theme: string) {
  const isLight =
    theme === "light" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: light)").matches);
  if (isLight) return LIGHT_TERMINAL_THEME;
  return theme === "dark-black" ? DARK_BLACK_TERMINAL_THEME : DARK_TERMINAL_THEME;
}

export type UseXtermArgs = Omit<
  TerminalInstanceProps,
  "paneId" | "readOnly" | "liveFeed" | "mirror"
> & {
  paneId: string | undefined;
  readOnly: boolean;
  liveFeed: boolean;
  mirror: boolean;
};

export function inActiveTab(paneId: string): boolean {
  const { tabs, activeTabId } = getProjectState();
  const tab = tabs.find((t) => t.id === activeTabId);
  return !!tab && layoutHasPane(tab.layout, paneId);
}

/** Mirrors draw on canvas: several open at once would eat into Chromium's ~16 WebGL contexts,
 *  and each one rebuilds its atlas on every font fit. Nor canvas-only CLIs, nor anything once
 *  the GPU fell back for good */
export function wantsWebgl(mirror: boolean, cliType: string | undefined): boolean {
  return !mirror && !(cliType && CANVAS_ONLY_CLI_TYPES.has(cliType)) && !webglBudget.isDomOnly();
}

/** On the container's parent: the container itself is display: none while hidden, and a hidden
 *  tab or the Agents area under the Dashboard is `visibility: hidden` */
export function isShown(container: HTMLElement): boolean {
  const el = container.parentElement ?? container;
  return el.checkVisibility?.({ visibilityProperty: true }) ?? true;
}

/** Refits on every box change; `disconnect` also cancels a pending mirror refit */
export function observeContainerSize(
  container: HTMLDivElement,
  mirror: boolean,
  refit: () => void,
) {
  let mirrorFitTimer: ReturnType<typeof setTimeout> | null = null;
  let observedBox = "";
  const resizeObserver = new ResizeObserver(([entry]) => {
    const width = entry?.contentRect.width ?? -1;
    if (mirror) {
      // The card sets both dimensions (the grid never sizes its box), so any
      // real change is news. A drag changes it every frame; refit once it
      // stops, since each font step rebuilds the glyph atlas
      const box = `${Math.round(width)}x${Math.round(entry?.contentRect.height ?? -1)}`;
      if (box === observedBox) return;
      observedBox = box;
      if (mirrorFitTimer) clearTimeout(mirrorFitTimer);
      mirrorFitTimer = setTimeout(refit, 120);
      return;
    }
    // ResizeObserver already fires at most once per frame
    refit();
  });
  resizeObserver.observe(container);
  return {
    disconnect: () => {
      if (mirrorFitTimer) clearTimeout(mirrorFitTimer);
      resizeObserver.disconnect();
    },
  };
}
