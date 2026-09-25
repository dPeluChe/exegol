import type { AgentCliType } from "@exegol/shared";
import { logger } from "../lib/logger";
import { readableStep } from "./readable-step";
import { coreRust } from "./spawn-env";
import { AgentStatusParser } from "./status-parser";

// ─── Types ──────────────────────────────────────────────────────────────────

export type ProcessResult = {
  status?: string;
  currentStep?: string;
  sessionId?: string;
  resumeCommand?: string;
  /** Deterministic hook/OSC-777 signals detected in this chunk (T123). */
  signals?: { agentId: string; event: string }[];
};

export type OutputProcessor = { process(data: string): ProcessResult };

// ─── Factory ────────────────────────────────────────────────────────────────

/**
 * One place for both paths: a TUI's status bar or border scraped as the step
 * painted glyph soup in the sidebar, and its status came from the same chrome
 * line (a bar ending in "?" read as waiting_input). Chrome drops both.
 */
export function readableScrape(status: string | undefined, step: string | undefined) {
  const currentStep = readableStep(step);
  return step && !currentStep ? { status: undefined, currentStep } : { status, currentStep };
}

const useRustProcessor = !!coreRust?.AgentOutputStream;
if (useRustProcessor) {
  logger.info(
    "[AgentOutputProcessor] Rust processing pipeline available — using native output processor",
  );
}

/**
 * Create an output processor for an agent session.
 * Uses Rust AgentOutputStream if available, JS fallback otherwise.
 * @param resumePattern - provider's `resumeCommandPattern` capability (empty = no resume detection)
 */
export function createOutputProcessor(
  _agentId: string,
  cliType: AgentCliType,
  resumePattern?: string,
): OutputProcessor {
  if (useRustProcessor) {
    try {
      // biome-ignore lint/style/noNonNullAssertion: guarded by useRustProcessor check above
      const stream = new coreRust!.AgentOutputStream(cliType, resumePattern ?? "");
      return {
        process(data: string) {
          const r = stream.processChunk(data);
          return {
            ...readableScrape(r.status ?? undefined, r.currentStep ?? undefined),
            sessionId: r.sessionId ?? undefined,
            resumeCommand: r.resumeCommand ?? undefined,
            signals: r.signals?.length
              ? r.signals.map((s) => ({ agentId: s.agentId, event: s.event }))
              : undefined,
          };
        },
      };
    } catch {
      // Fall through to JS on instantiation error
    }
  }

  const parser = new AgentStatusParser(_agentId, cliType, resumePattern);
  return {
    process(data: string) {
      const u = parser.parse(data);
      return {
        ...readableScrape(u?.status, u?.currentStep),
        sessionId: u?.sessionId,
        resumeCommand: u?.resumeCommand,
        signals: u?.signals,
      };
    },
  };
}
