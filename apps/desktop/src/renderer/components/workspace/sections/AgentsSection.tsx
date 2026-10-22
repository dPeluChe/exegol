import { useEffect, useLayoutEffect, useRef } from "react";
import { ProjectScope, TabShown } from "../../../contexts/ProjectScope";
import { useMountEffect } from "../../../hooks/use-mount-effect";
import { dispatchRefitTerminals } from "../../../lib/dispatch-refit";
import {
  getActivePaneId,
  selectActiveTabIdOf,
  selectTabsOf,
  useWorkspaceStore,
} from "../../../stores/workspace";
import { mountedLayers } from "../../../stores/workspace/helpers";
import { WorkspaceLayout } from "../WorkspaceLayout";
import { WorkspaceTabBar } from "../WorkspaceTabBar";

// ─── All Tabs Layout (keep terminals alive across tab switches) ──────────────

function AllTabsLayout({ projectId, shown }: { projectId: string; shown: boolean }) {
  const tabs = useWorkspaceStore(selectTabsOf(projectId));
  const activeTabId = useWorkspaceStore(selectActiveTabIdOf(projectId));
  const ensureDefaultTab = useWorkspaceStore((s) => s.ensureDefaultTab);
  const prevActiveTabId = useRef(activeTabId);

  // Force xterm.js re-fit when switching workspace tabs
  useEffect(() => {
    if (activeTabId !== prevActiveTabId.current) {
      prevActiveTabId.current = activeTabId;
      dispatchRefitTerminals();
    }
  }, [activeTabId]);

  // ensureDefaultTab acts on the active project only
  useEffect(() => {
    if (shown && tabs.length === 0) ensureDefaultTab();
  }, [shown, tabs.length, ensureDefaultTab]);

  if (tabs.length === 0) return null;

  return (
    <>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={tab.id === activeTabId ? "h-full" : "invisible absolute inset-0"}
        >
          <TabShown shown={tab.id === activeTabId}>
            <WorkspaceLayout layout={tab.layout} tabId={tab.id} />
          </TabShown>
        </div>
      ))}
    </>
  );
}

// ─── One project's layer (kept mounted while hidden: stores/workspace/helpers#keepMounted) ──

function ProjectLayer({ projectId, shown }: { projectId: string; shown: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const wasShown = useRef(shown);

  // Before paint: a hidden layer takes no keys, clicks or Tab, and lets go of the focus it held
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.inert = !shown;
    const focused = document.activeElement;
    if (!shown && focused instanceof HTMLElement && el.contains(focused)) focused.blur();
  }, [shown]);

  // Shown again without a remount: no view mounts to take the keyboard, so the active pane gets
  // it as a mounting terminal would (only when nothing else holds it)
  useEffect(() => {
    const back = shown && !wasShown.current;
    wasShown.current = shown;
    if (!back) return;
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        const focused = document.activeElement;
        if (focused && focused !== document.body) return;
        const paneId = getActivePaneId();
        if (paneId) {
          window.dispatchEvent(new CustomEvent("exegol:focus-pane", { detail: { paneId } }));
        }
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [shown]);

  return (
    <div ref={ref} className={shown ? "h-full" : "invisible absolute inset-0"}>
      <ProjectScope projectId={projectId} shown={shown}>
        <AllTabsLayout projectId={projectId} shown={shown} />
      </ProjectScope>
    </div>
  );
}

// ─── Agents Section ─────────────────────────────────────────────────────────

export function AgentsSection() {
  const activeProjectId = useWorkspaceStore((s) => s._activeProjectId);
  const mounted = useWorkspaceStore((s) => s.mountedProjects);
  const ensureDefaultTab = useWorkspaceStore((s) => s.ensureDefaultTab);
  const prevProjectId = useRef(activeProjectId);

  // Ensure at least one tab exists on mount (Rule 4: mount effect for setup)
  useMountEffect(() => {
    ensureDefaultTab();
  });

  // A kept project shown again refits its terminals; the one hidden lets them go display: none
  useEffect(() => {
    if (activeProjectId === prevProjectId.current) return;
    prevProjectId.current = activeProjectId;
    dispatchRefitTerminals();
  }, [activeProjectId]);

  if (!activeProjectId) return null;

  return (
    <div className="flex h-full flex-col">
      <WorkspaceTabBar />
      <div className="relative flex-1 overflow-hidden">
        {mountedLayers(mounted, activeProjectId).map((pid) => (
          <ProjectLayer key={pid} projectId={pid} shown={pid === activeProjectId} />
        ))}
      </div>
    </div>
  );
}
