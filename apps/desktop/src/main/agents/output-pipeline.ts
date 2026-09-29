import { createOutputProcessor } from "./agent-output-processor";
import type { SessionMaps } from "./agent-session-callbacks";
import { getProviderRegistry } from "./registry";
import { type AgentContext, broadcastAgentStatus } from "./spawn-env";
import { createTitleStatusTracker } from "./title-status";

/** CLIs that report their state in the terminal title (T56) */
const TITLE_TRACKED = new Set(["claude-code", "gemini", "codex", "crush"]);

/** What turns a PTY's output into agent status: the parser, the title tracker, and the
 *  scrollback kept for scoring and attention tails. Shells run without it. */
export function attachOutputPipeline(maps: SessionMaps, agent: AgentContext): void {
  const resumePattern = getProviderRegistry().get(agent.cliType)?.capabilities
    ?.resumeCommandPattern;
  maps.outputProcessors.set(
    agent.id,
    createOutputProcessor(agent.id, agent.cliType, resumePattern),
  );
  if (TITLE_TRACKED.has(agent.cliType)) {
    maps.titleTrackers.set(
      agent.id,
      createTitleStatusTracker((status) => {
        broadcastAgentStatus({
          agentId: agent.id,
          projectId: agent.projectId,
          status,
          currentStep: null,
          cliType: agent.cliType,
          timestamp: Date.now(),
        });
      }),
    );
  } else {
    maps.titleTrackers.delete(agent.id);
  }
  maps.scrollbackBuffers.set(agent.id, []);
  maps.scrollbackSizes.set(agent.id, 0);
}

export function detachOutputPipeline(maps: SessionMaps, agentId: string): void {
  maps.outputProcessors.delete(agentId);
  maps.titleTrackers.delete(agentId);
  maps.scrollbackBuffers.delete(agentId);
  maps.scrollbackSizes.delete(agentId);
}
