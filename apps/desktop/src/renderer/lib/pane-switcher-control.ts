import { create } from "zustand";
import { useAppStore } from "../stores/app";
import { getProjectState, useWorkspaceStore } from "../stores/workspace";
import { focusActivePane } from "./pane-focus";
import {
  buildSwitcherItems,
  initialIndex,
  isQuickSwitch,
  QUICK_SWITCH_MS,
  quickSwitchTarget,
  type SwitcherItem,
  stepIndex,
} from "./pane-switcher";

interface SwitcherView {
  items: SwitcherItem[];
  index: number;
  current: string | null;
}

interface Session extends SwitcherView {
  presses: number;
  startedAt: number;
  backwards: boolean;
  quick: string | null;
  shown: boolean;
}

/** What the overlay shows; null while hidden (also during a quick switch) */
export const usePaneSwitcherView = create<{ view: SwitcherView | null }>(() => ({ view: null }));

let session: Session | null = null;
let showTimer: ReturnType<typeof setTimeout> | undefined;

function publish(): void {
  const s = session;
  usePaneSwitcherView.setState({
    view: s?.shown ? { items: s.items, index: s.index, current: s.current } : null,
  });
}

function show(): void {
  clearTimeout(showTimer);
  if (!session) return;
  session.shown = true;
  publish();
}

function start(backwards: boolean): void {
  const projectId = useAppStore.getState().activeProjectId;
  if (!projectId) return;
  const ws = useWorkspaceStore.getState();
  const mru = ws.paneMru[projectId] ?? [];
  const items = buildSwitcherItems(getProjectState().tabs, mru);
  if (items.length === 0) return;
  const current = ws.focusedPaneId;
  const quick = quickSwitchTarget(mru, current, new Set(items.map((it) => it.paneId)));
  session = {
    items,
    index: initialIndex(items, current, quick, backwards ? "prev" : "next"),
    current,
    presses: 1,
    startedAt: performance.now(),
    backwards,
    quick,
    shown: false,
  };
  // A focused page keeps the keyboard otherwise: Tab, arrows and Esc must reach the switcher
  const active = document.activeElement as HTMLElement | null;
  if (active?.tagName === "WEBVIEW") active.blur();
  showTimer = setTimeout(show, QUICK_SWITCH_MS);
}

function press(backwards: boolean): void {
  if (!session) {
    start(backwards);
    return;
  }
  session.presses += 1;
  move(backwards ? "prev" : "next");
}

function move(direction: "next" | "prev"): void {
  if (!session) return;
  session.index = stepIndex(session.index, session.items.length, direction);
  show();
}

function end(): void {
  clearTimeout(showTimer);
  session = null;
  publish();
}

function activate(item: SwitcherItem | undefined): void {
  if (!item) return;
  if (getProjectState().activeTabId !== item.tabId) {
    useWorkspaceStore.getState().setActiveTab(item.tabId);
  }
  const app = useAppStore.getState();
  if (app.activeView !== "workspace") app.setActiveView("workspace");
  focusActivePane(item.paneId);
}

function commit(): void {
  const s = session;
  if (!s) return;
  end();
  if (!s.backwards && isQuickSwitch(s.presses, performance.now() - s.startedAt)) {
    activate(s.items.find((it) => it.kind === "pane" && it.paneId === s.quick));
    return;
  }
  activate(s.items[s.index]);
}

/** A click on a row: go there, whatever Ctrl does next */
export function selectSwitcherItem(index: number): void {
  const item = session?.items[index];
  end();
  activate(item);
}

/** Ctrl+Tab: hold Ctrl for the switcher, a quick press goes back to the previous pane */
export function installPaneSwitcherKeys(): () => void {
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Tab" && e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      e.stopPropagation();
      press(e.shiftKey);
      return;
    }
    if (!session) return;
    const direction = e.key === "ArrowDown" ? "next" : e.key === "ArrowUp" ? "prev" : null;
    if (!direction && e.key !== "Escape" && e.key !== "Enter") return;
    e.preventDefault();
    e.stopPropagation();
    if (direction) move(direction);
    else if (e.key === "Escape") end();
    else commit();
  };
  const onKeyUp = (e: KeyboardEvent) => {
    if (session && e.key === "Control") commit();
  };
  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("keyup", onKeyUp, true);
  window.addEventListener("blur", end);
  const unsubPage = window.api.onPaneSwitcherKey((key) => {
    if (key.kind === "tab") press(!!key.shift);
    else commit();
  });
  return () => {
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("keyup", onKeyUp, true);
    window.removeEventListener("blur", end);
    unsubPage();
    end();
  };
}
