import type { AgentStatus } from "@exegol/shared";
import { BrowserWindow } from "electron";
import type Database from "libsql";
import { updateAgentStatus } from "../db/queries";
import { logger } from "../lib/logger";
import type { OutputProcessor } from "./agent-output-processor";
import { createHandoff, generateHandoffFromScrollback } from "./handoff";
import {
  type AgentContext,
  broadcastAgentStatus,
  finalizeAgentStatus,
  scoreAndRecordOplog,
} from "./spawn-env";

export interface SessionMaps {
  outputProcessors: Map<string, OutputProcessor>;
  titleTrackers: Map<string, (data: string) => void>;
  scrollbackBuffers: Map<string, string[]>;
  scrollbackSizes: Map<string, number>;
  tokenLimitDetected: Set<string>;
  completionCallbacks: Map<string, (exitCode: number) => void>;
  initialSnapshots: Map<string, { headSha: string; cwd: string; projectId: string }>;
  dataCallbacks: Map<string, (data: string) => void>;
}

export function createSpawnCallbacks(
  db: Database.Database,
  agent: AgentContext,
  maps: SessionMaps,
  onCleanupWorktree: (db: Database.Database, agentId: string) => void | Promise<void>,
  maxScrollbackBytes: number,
) {
  return {
    onData: (data: string) => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send("terminal:data", agent.id, data);
      }
      maps.dataCallbacks.get(agent.id)?.(data);
      maps.titleTrackers.get(agent.id)?.(data);

      // Skip output processing for shells and interactive TUI CLIs
      // (their output contains TUI escape sequences and status-like text that
      // the parser misinterprets as "failed"/"waiting_input")
      const SKIP_PARSING: Set<string> = new Set(["shell", "crush", "opencode", "kiro"]);
      if (SKIP_PARSING.has(agent.cliType)) return;

      const currentSize = maps.scrollbackSizes.get(agent.id) ?? 0;
      if (currentSize < maxScrollbackBytes) {
        maps.scrollbackBuffers.get(agent.id)?.push(data);
        maps.scrollbackSizes.set(agent.id, currentSize + data.length);
      }

      const processor = maps.outputProcessors.get(agent.id);
      if (!processor) return;
      const result = processor.process(data);
      if (result.status || result.currentStep) {
        if (result.status) {
          logger.info(
            `[AgentCallback] Status change: ${agent.id} (${agent.cliType}) → ${result.status}${result.currentStep ? ` [${result.currentStep}]` : ""}`,
          );
          updateAgentStatus(db, agent.id, result.status as AgentStatus, result.currentStep);
          broadcastAgentStatus({
            agentId: agent.id,
            projectId: agent.projectId,
            status: result.status as AgentStatus,
            currentStep: result.currentStep ?? null,
            cliType: agent.cliType,
            timestamp: Date.now(),
          });
        } else if (result.currentStep) {
          updateAgentStatus(db, agent.id, "running", result.currentStep);
          broadcastAgentStatus({
            agentId: agent.id,
            projectId: agent.projectId,
            status: "running",
            currentStep: result.currentStep,
            cliType: agent.cliType,
            timestamp: Date.now(),
          });
        }
      }

      if (result.tokenLimitWarning && !maps.tokenLimitDetected.has(agent.id)) {
        maps.tokenLimitDetected.add(agent.id);
        try {
          const scrollback = maps.scrollbackBuffers.get(agent.id)?.join("") ?? "";
          const summary = generateHandoffFromScrollback(agent.taskDescription, scrollback);
          const handoff = createHandoff(db, { agentId: agent.id, ...summary });
          for (const win of BrowserWindow.getAllWindows()) {
            win.webContents.send("agent:handoff-ready", agent.id, handoff.id);
          }
          logger.info(
            `[AgentManager] Token limit detected for ${agent.id}, handoff created: ${handoff.id}`,
          );
        } catch (err) {
          logger.error(`[AgentManager] Failed to create handoff for ${agent.id}:`, err);
        }
      }
    },

    onExit: (exitCode: number) => {
      logger.info(`[AgentCallback] onExit: ${agent.id} (${agent.cliType}) exitCode=${exitCode}`);
      const isShell = agent.cliType === "shell";
      const scrollbackForScoring = isShell
        ? ""
        : (maps.scrollbackBuffers.get(agent.id)?.join("") ?? "");

      maps.outputProcessors.delete(agent.id);
      maps.titleTrackers.delete(agent.id);
      maps.tokenLimitDetected.delete(agent.id);
      maps.scrollbackBuffers.delete(agent.id);
      maps.scrollbackSizes.delete(agent.id);

      finalizeAgentStatus(db, agent, exitCode);

      if (!isShell) {
        scoreAndRecordOplog(
          db,
          agent,
          exitCode,
          scrollbackForScoring,
          maps.initialSnapshots.get(agent.id),
        );
      }
      maps.initialSnapshots.delete(agent.id);

      try {
        onCleanupWorktree(db, agent.id);
      } catch {
        /* DB closed during shutdown — non-fatal */
      }

      const completionCb = maps.completionCallbacks.get(agent.id);
      if (completionCb) {
        maps.completionCallbacks.delete(agent.id);
        completionCb(exitCode);
      }
    },

    onError: (message: string) => {
      logger.error(`[AgentManager] PTY error for ${agent.id}: ${message}`);
    },
  };
}
