import type { OutputProcessor } from "./agent-output-processor";
import type { AgentContext } from "./spawn-env";

export interface SessionMaps {
  outputProcessors: Map<string, OutputProcessor>;
  titleTrackers: Map<string, (data: string) => void>;
  scrollbackBuffers: Map<string, string[]>;
  scrollbackSizes: Map<string, number>;
  completionCallbacks: Map<string, (exitCode: number) => void>;
  initialSnapshots: Map<string, { headSha: string; cwd: string; projectId: string }>;
  dataCallbacks: Map<string, (data: string) => void>;
  /** Agents whose Claude session ID has already been captured + stored (T101). */
  sessionIdsCaptured: Set<string>;
  /** Stop pressed: the kill's exit code (often non-zero) must not read as a failure */
  stopRequested: Set<string>;
  /** Each live session's context, so a shell can be promoted in place */
  contexts: Map<string, AgentContext>;
}
