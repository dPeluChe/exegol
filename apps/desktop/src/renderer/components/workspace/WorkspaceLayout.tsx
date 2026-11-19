import { Fragment, useEffect, useLayoutEffect, useRef } from "react";
import {
  type ImperativePanelGroupHandle,
  Panel,
  PanelGroup,
  PanelResizeHandle,
} from "react-resizable-panels";
import { useShallow } from "zustand/react/shallow";
import { usePaneProject } from "../../contexts/ProjectScope";
import { HOST_ATTR, HOSTED_PANE_TYPES, placeHosts, SLOT_ATTR } from "../../lib/pane-hosts";
import { type LayoutNode, selectPanesOf, useWorkspaceStore } from "../../stores/workspace";
import { collectPaneIds } from "../../stores/workspace/helpers";
import { WorkspacePane } from "./WorkspacePane";

// ─── Layout Renderer ────────────────────────────────────────────────────────

interface LayoutRendererProps {
  node: LayoutNode;
  tabId: string;
  /** Child indexes from the tab's root: how the store finds this split */
  path: number[];
}

/** A drag fires onLayout every frame; the store (and its persistence) hears the last one */
const SAVE_DELAY_MS = 200;

/** A hosted pane leaves only its slot in the tree: its content is in the layer above */
function Leaf({ paneId, tabId }: { paneId: string; tabId: string }) {
  const { projectId } = usePaneProject();
  const hosted = useWorkspaceStore((s) =>
    HOSTED_PANE_TYPES.has(selectPanesOf(projectId)(s)[paneId]?.type ?? ""),
  );
  if (!hosted) return <WorkspacePane paneId={paneId} tabId={tabId} />;
  return <div {...{ [SLOT_ATTR]: paneId }} className="h-full w-full" />;
}

function LayoutRenderer({ node, tabId, path }: LayoutRendererProps) {
  const groupRef = useRef<ImperativePanelGroupHandle>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sizes = node.type === "split" ? node.sizes : null;

  // Sizes come from the store: a drag used to live only inside the panel
  // library, so switching projects (a remount) reset every split to its
  // initial sizes, and Equalize changed the store without moving anything
  useEffect(() => {
    const group = groupRef.current;
    if (!group || !sizes) return;
    const current = group.getLayout();
    if (
      sizes.length === current.length &&
      sizes.some((v, i) => Math.abs(v - (current[i] ?? 0)) > 0.5)
    ) {
      group.setLayout(sizes);
    }
  }, [sizes]);

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    [],
  );

  if (node.type === "pane") return <Leaf paneId={node.paneId} tabId={tabId} />;

  return (
    <PanelGroup
      ref={groupRef}
      direction={node.direction}
      id={`group-${tabId}-${path.join("-")}`}
      onLayout={(layout) => {
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(
          () => useWorkspaceStore.getState().setSplitSizes(tabId, path, layout),
          SAVE_DELAY_MS,
        );
      }}
    >
      {node.children.map((child, i) => {
        const panelId =
          child.type === "pane" ? child.paneId : `split-${tabId}-${[...path, i].join("-")}`;
        return (
          <Fragment key={panelId}>
            {i > 0 && (
              <PanelResizeHandle className="data-[resize-handle-state=hover]:bg-accent/50 data-[resize-handle-state=drag]:bg-accent bg-border transition-colors data-[panel-group-direction=horizontal]:w-px data-[panel-group-direction=vertical]:h-px" />
            )}
            <Panel id={panelId} order={i} defaultSize={node.sizes[i] ?? 50} minSize={10}>
              <LayoutRenderer node={child} tabId={tabId} path={[...path, i]} />
            </Panel>
          </Fragment>
        );
      })}
    </PanelGroup>
  );
}

// ─── Workspace Layout (public) ──────────────────────────────────────────────

interface WorkspaceLayoutProps {
  layout: LayoutNode;
  tabId: string;
}

export function WorkspaceLayout({ layout, tabId }: WorkspaceLayoutProps) {
  const layer = useRef<HTMLDivElement>(null);
  const { projectId } = usePaneProject();
  const hosted = useWorkspaceStore(
    useShallow((s) => {
      const panes = selectPanesOf(projectId)(s);
      return collectPaneIds(layout).filter((id) => HOSTED_PANE_TYPES.has(panes[id]?.type ?? ""));
    }),
  );

  // Before paint, on every change of the tree: a host is never seen off its slot. Any move of a
  // slot comes with a panel changing size, so the panels are what is watched
  // biome-ignore lint/correctness/useExhaustiveDependencies: the tree and the hosts are the triggers
  useLayoutEffect(() => {
    const el = layer.current;
    if (!el) return;
    placeHosts(el);
    const watch = new ResizeObserver(() => placeHosts(el));
    watch.observe(el);
    for (const part of el.querySelectorAll(`[data-panel], [${SLOT_ATTR}]`)) watch.observe(part);
    return () => watch.disconnect();
  }, [layout, hosted]);

  return (
    <div ref={layer} className="relative h-full w-full">
      <LayoutRenderer node={layout} tabId={tabId} path={[]} />
      {hosted.map((paneId) => (
        <div key={paneId} {...{ [HOST_ATTR]: paneId }} className="absolute">
          <WorkspacePane paneId={paneId} tabId={tabId} />
        </div>
      ))}
    </div>
  );
}
