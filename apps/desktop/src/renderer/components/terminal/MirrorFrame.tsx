import type { ComponentProps, Ref } from "react";
import type { AgentState } from "../../stores/agents";
import { ErrorBoundary, paneFallback } from "../ErrorBoundary";
import { TerminalInstance, type TerminalInstanceHandle } from "./TerminalInstance";
import type { TerminalInstanceProps } from "./terminal-types";

/** A session's mirror outside its pane; `data-mirror-agent-id` is how dictation finds it */
export function MirrorFrame({
  agent,
  terminalRef,
  cardFont,
  menuOnRightButton,
  ...frame
}: {
  agent: Pick<AgentState, "id" | "cliType">;
  terminalRef?: Ref<TerminalInstanceHandle>;
  cardFont?: TerminalInstanceProps["cardFont"];
  menuOnRightButton?: boolean;
} & ComponentProps<"div">) {
  return (
    <div
      {...frame}
      data-mirror-agent-id={agent.id}
      // Our menu takes the right button: a TUI tracking the mouse must not get the press
      onMouseDownCapture={
        menuOnRightButton
          ? (e) => {
              if (e.button === 2) e.stopPropagation();
            }
          : undefined
      }
    >
      <ErrorBoundary fallback={paneFallback}>
        <TerminalInstance
          ref={terminalRef}
          agentId={agent.id}
          cliType={agent.cliType}
          mirror
          cardFont={cardFont}
        />
      </ErrorBoundary>
    </div>
  );
}
