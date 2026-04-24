import { getAgentManager } from "../agents/manager";
import { getProviderRegistry } from "../agents/registry";
import { getDb } from "../db/client";
import { getMcpHost } from "../mcp/host";
import { getPipelineExecutor } from "../pipeline/executor";
import { getSchedulerEngine } from "../scheduler/engine";

export function createContext() {
  return {
    db: getDb(),
    agentManager: getAgentManager(),
    providerRegistry: getProviderRegistry(),
    pipelineExecutor: getPipelineExecutor(),
    schedulerEngine: getSchedulerEngine(),
    mcpHost: getMcpHost(),
  };
}

export type Context = ReturnType<typeof createContext>;
