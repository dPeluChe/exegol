/**
 * T150 — golden parity vectors shared with the Rust implementation
 * (packages/core-rust/src/processing/parity_vectors_tests.rs).
 * Rust is the source of truth; the JS mirror must produce identical results.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { AgentCliType } from "@exegol/shared";
import { describe, expect, it } from "vitest";
import { AgentStatusParser, OscNotifyScanner, stripAnsi } from "./status-parser";

interface StripCase {
  name: string;
  input: string;
  expected: string;
}

interface SignalCase {
  name: string;
  chunks: string[];
  expected: { agentId: string; event: string }[];
}

interface StatusCase {
  name: string;
  cliType: string;
  resumePattern?: string;
  chunks: string[];
  expectedStatus: string | null;
  expectedStep: string | null;
  expectedTokenLimit?: boolean;
  expectedSessionId?: string | null;
  expectedResume?: string | null;
}

interface Vectors {
  strip: StripCase[];
  signals: SignalCase[];
  status: StatusCase[];
}

const vectorsPath = fileURLToPath(
  new URL("../../../../../packages/core-rust/test-vectors/parser-vectors.json", import.meta.url),
);
const vectors = JSON.parse(readFileSync(vectorsPath, "utf-8")) as Vectors;

describe("parity: stripAnsi", () => {
  for (const c of vectors.strip) {
    it(c.name, () => {
      expect(stripAnsi(c.input)).toBe(c.expected);
    });
  }
});

describe("parity: OscNotifyScanner", () => {
  for (const c of vectors.signals) {
    it(c.name, () => {
      const scanner = new OscNotifyScanner();
      const got = c.chunks.flatMap((chunk) => scanner.scan(chunk));
      expect(got).toEqual(c.expected);
    });
  }
});

describe("parity: AgentStatusParser", () => {
  for (const c of vectors.status) {
    it(c.name, () => {
      const parser = new AgentStatusParser("test", c.cliType as AgentCliType, c.resumePattern);
      let status: string | null = null;
      let step: string | null = null;
      let tokenLimit = false;
      let sessionId: string | null = null;
      let resume: string | null = null;

      for (const chunk of c.chunks) {
        const update = parser.parse(chunk);
        if (!update) continue;
        if (update.status !== undefined || update.currentStep !== undefined) {
          status = update.status ?? null;
          step = update.currentStep ?? null;
        }
        tokenLimit = tokenLimit || update.tokenLimitWarning === true;
        if (update.sessionId !== undefined) sessionId = update.sessionId;
        if (update.resumeCommand !== undefined) resume = update.resumeCommand;
      }

      expect(status).toBe(c.expectedStatus);
      expect(step).toBe(c.expectedStep);
      expect(tokenLimit).toBe(c.expectedTokenLimit ?? false);
      expect(sessionId).toBe(c.expectedSessionId ?? null);
      expect(resume).toBe(c.expectedResume ?? null);
    });
  }
});
