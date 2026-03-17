import { X } from "lucide-react";
import { useEffect } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { type PaneNode, useTerminalStore } from "../../stores/terminals";
import { PaneAgentSelector } from "./PaneAgentSelector";
import { TerminalPanel } from "./TerminalPanel";

interface TerminalSplitViewProps {
  agentId: string;
}

export function TerminalSplitView({ agentId }: TerminalSplitViewProps) {
  const layout = useTerminalStore((s) => s.getLayout(agentId));
  const initLayout = useTerminalStore((s) => s.initLayout);
  const splitPane = useTerminalStore((s) => s.splitPane);

  // Ensure layout exists for this agent
  useEffect(() => {
    if (!layout) {
      initLayout(agentId);
    }
  }, [agentId, layout, initLayout]);

  // Listen for split-pane events from hotkeys
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ direction: "horizontal" | "vertical" }>).detail;
      const currentLayout = useTerminalStore.getState().getLayout(agentId);
      if (!currentLayout) return;

      const firstTerminal = findFirstTerminal(currentLayout);
      if (firstTerminal) {
        splitPane(agentId, firstTerminal.id, detail.direction);
      }
    };

    window.addEventListener("exegol:split-pane", handler);
    return () => window.removeEventListener("exegol:split-pane", handler);
  }, [agentId, splitPane]);

  if (!layout) {
    return <TerminalPanel agentId={agentId} />;
  }

  return <PaneNodeRenderer node={layout} rootAgentId={agentId} />;
}

function findFirstTerminal(node: PaneNode): PaneNode | null {
  if (node.type === "terminal") return node;
  for (const child of node.children) {
    const found = findFirstTerminal(child);
    if (found) return found;
  }
  return null;
}

function PaneNodeRenderer({ node, rootAgentId }: { node: PaneNode; rootAgentId: string }) {
  if (node.type === "terminal") {
    if (!node.agentId) {
      return <PaneAgentSelector paneId={node.id} rootAgentId={rootAgentId} />;
    }
    return (
      <TerminalPaneWrapper paneId={node.id} agentId={node.agentId} rootAgentId={rootAgentId} />
    );
  }

  const direction = node.direction === "horizontal" ? "horizontal" : "vertical";

  return (
    <PanelGroup direction={direction}>
      {node.children.map((child, idx) => (
        <PaneWithHandle key={child.id} node={child} isFirst={idx === 0} rootAgentId={rootAgentId} />
      ))}
    </PanelGroup>
  );
}

function PaneWithHandle({
  node,
  isFirst,
  rootAgentId,
}: {
  node: PaneNode;
  isFirst: boolean;
  rootAgentId: string;
}) {
  return (
    <>
      {!isFirst && (
        <PanelResizeHandle className="data-[resize-handle-state=hover]:bg-accent/50 data-[resize-handle-state=drag]:bg-accent bg-border transition-colors data-[panel-group-direction=horizontal]:w-px data-[panel-group-direction=vertical]:h-px" />
      )}
      <Panel id={node.id} minSize={10}>
        <PaneNodeRenderer node={node} rootAgentId={rootAgentId} />
      </Panel>
    </>
  );
}

/** Wraps a terminal with a close button when inside a split layout */
function TerminalPaneWrapper({
  paneId,
  agentId,
  rootAgentId,
}: {
  paneId: string;
  agentId: string;
  rootAgentId: string;
}) {
  const closePane = useTerminalStore((s) => s.closePane);
  const layout = useTerminalStore((s) => s.getLayout(rootAgentId));
  const isSplit = layout?.type === "split";

  return (
    <div className="relative flex h-full flex-col">
      {isSplit && (
        <div className="absolute right-1 top-1 z-10">
          <button
            type="button"
            onClick={() => closePane(rootAgentId, paneId)}
            className="rounded p-0.5 text-text-muted/50 hover:bg-bg-secondary hover:text-text-primary transition-colors"
            title="Close pane"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}
      <div className="flex-1">
        <TerminalPanel agentId={agentId} />
      </div>
    </div>
  );
}
