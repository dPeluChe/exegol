import type { AgentCliType } from "@exegol/shared";
import { logger } from "../lib/logger";
import { coreRust } from "./spawn-env";
import { AgentStatusParser } from "./status-parser";

// ─── Types ──────────────────────────────────────────────────────────────────

export type ProcessResult = {
  status?: string;
  currentStep?: string;
  tokenLimitWarning: boolean;
};

export type OutputProcessor = { process(data: string): ProcessResult };

// ─── Factory ────────────────────────────────────────────────────────────────

const useRustProcessor = !!coreRust?.AgentOutputStream;
if (useRustProcessor) {
  logger.info(
    "[AgentOutputProcessor] Rust processing pipeline available — using native output processor",
  );
}

/**
 * Create an output processor for an agent session.
 * Uses Rust AgentOutputStream if available, JS fallback otherwise.
 */
export function createOutputProcessor(_agentId: string, cliType: AgentCliType): OutputProcessor {
  if (useRustProcessor) {
    try {
      // biome-ignore lint/style/noNonNullAssertion: guarded by useRustProcessor check above
      const stream = new coreRust!.AgentOutputStream(cliType);
      return {
        process(data: string) {
          const r = stream.processChunk(data);
          return {
            status: r.status ?? undefined,
            currentStep: r.currentStep ?? undefined,
            tokenLimitWarning: r.tokenLimitWarning,
          };
        },
      };
    } catch {
      // Fall through to JS on instantiation error
    }
  }

  const parser = new AgentStatusParser(_agentId, cliType);
  return {
    process(data: string) {
      const u = parser.parse(data);
      return {
        status: u?.status,
        currentStep: u?.currentStep,
        tokenLimitWarning: u?.tokenLimitWarning ?? false,
      };
    },
  };
}
