import { submitToAgent } from "../../lib/agent-input";
import { buildDesignIssue, type CapturedElement } from "../../lib/design-capture";
import { useToastStore } from "../../stores/toasts";
import { type AgentRef, IssueBubble } from "../common/IssueBubble";

/** T102: Design Mode — floating issue reporter for the captured element; every exit clears it */
export function DesignIssueBubble({
  element,
  message,
  onMessageChange,
  agents,
  onClear,
}: {
  element: CapturedElement;
  message: string;
  onMessageChange: (message: string) => void;
  agents: AgentRef[];
  /** Drops the captured element and the typed message */
  onClear: () => void;
}) {
  return (
    <IssueBubble
      element={element}
      message={message}
      onMessageChange={onMessageChange}
      agents={agents}
      onSend={(agentId) => {
        submitToAgent(agentId, buildDesignIssue(element, message));
        onClear();
      }}
      onCopy={() => {
        navigator.clipboard.writeText(buildDesignIssue(element, message));
        useToastStore.getState().addToast({ type: "success", title: "Design report copied" });
        onClear();
      }}
      onDismiss={onClear}
    />
  );
}
