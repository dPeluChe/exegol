import type { AgentCliType } from "@exegol/shared";
import { getProviderRegistry } from "./registry";

/**
 * The label a session is known by. The task is optional at every launcher — a
 * launch can be just "say hello" — but a blank label makes an agent
 * unidentifiable in the dashboard, the tab bar and `agent_send` addressing.
 *
 * Applied inside `createAgent` rather than at each caller on purpose: the modal
 * used to do this itself, so pipelines, the scheduler and the queue produced
 * blank-labelled agents. One funnel is the point.
 */
export function resolveTaskLabel(cliType: AgentCliType, taskDescription?: string): string {
  return taskDescription?.trim() || getProviderRegistry().get(cliType)?.name || cliType;
}
