import { buildDesignIssue, type CapturedElement } from "../../lib/design-capture";
import { type AgentRef, IssueBubble } from "../common/IssueBubble";
import { sendToAgent } from "./send-to-agent";

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
        sendToAgent(agentId, buildDesignIssue(element, message));
        onClear();
      }}
      onCopy={() => {
        navigator.clipboard.writeText(buildDesignIssue(element, message));
        onClear();
      }}
      onDismiss={onClear}
    />
  );
}
