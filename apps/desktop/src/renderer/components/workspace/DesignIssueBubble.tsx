import { submitToAgent } from "../../lib/agent-input";
import { buildDesignIssue, type CapturedElement } from "../../lib/design-capture";
import { useToastStore } from "../../stores/toasts";
import { IssueBubble } from "../common/IssueBubble";
import type { TargetPicker } from "../terminal/use-send-to";

/** T102: Design Mode — floating issue reporter for the captured element; every exit clears it */
export function DesignIssueBubble({
  element,
  message,
  onMessageChange,
  targets,
  onClear,
}: {
  element: CapturedElement;
  message: string;
  onMessageChange: (message: string) => void;
  targets: TargetPicker;
  /** Drops the captured element and the typed message */
  onClear: () => void;
}) {
  return (
    <IssueBubble
      element={element}
      message={message}
      onMessageChange={onMessageChange}
      targets={targets}
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
