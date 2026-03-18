import { Fragment } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import type { LayoutNode } from "../../stores/workspace";
import { WorkspacePane } from "./WorkspacePane";

// ─── Layout Renderer ────────────────────────────────────────────────────────

interface LayoutRendererProps {
  node: LayoutNode;
  tabId: string;
}

function LayoutRenderer({ node, tabId }: LayoutRendererProps) {
  if (node.type === "pane") {
    return <WorkspacePane paneId={node.paneId} tabId={tabId} />;
  }

  return (
    <PanelGroup direction={node.direction}>
      {node.children.map((child, i) => {
        const key = child.type === "pane" ? child.paneId : `split-${tabId}-${i}`;
        return (
          <Fragment key={key}>
            {i > 0 && (
              <PanelResizeHandle className="data-[resize-handle-state=hover]:bg-accent/50 data-[resize-handle-state=drag]:bg-accent bg-border transition-colors data-[panel-group-direction=horizontal]:w-px data-[panel-group-direction=vertical]:h-px" />
            )}
            <Panel defaultSize={node.sizes[i] ?? 50} minSize={10}>
              <LayoutRenderer node={child} tabId={tabId} />
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
  return (
    <div className="h-full w-full">
      <LayoutRenderer node={layout} tabId={tabId} />
    </div>
  );
}
