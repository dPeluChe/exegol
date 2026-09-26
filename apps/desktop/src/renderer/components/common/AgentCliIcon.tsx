import { useDisplayCli } from "../../hooks/use-display-cli";
import { AgentIcon } from "./AgentIcon";

/** The agent's icon; a plain terminal running `claude` (typed by hand) shows Claude's */
export function AgentCliIcon({
  agent,
  size,
  className,
}: {
  agent: { id: string; cliType: string };
  size?: number;
  className?: string;
}) {
  return <AgentIcon provider={useDisplayCli(agent)} size={size} className={className} />;
}
