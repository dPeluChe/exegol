import type { AgentAccessMode } from "./agent";

// ─── Pipeline Status ───────────────────────────────────────────────────────

export const PIPELINE_RUN_STATUSES = [
  "pending",
  "running",
  "paused",
  "completed",
  "failed",
  "cancelled",
] as const;
export type PipelineRunStatus = (typeof PIPELINE_RUN_STATUSES)[number];

export const PIPELINE_STEP_ROLES = ["implement", "review", "fix", "verify", "custom"] as const;
export type PipelineStepRole = (typeof PIPELINE_STEP_ROLES)[number];

export const PIPELINE_STEP_STATUSES = [
  "pending",
  "running",
  "completed",
  "failed",
  "skipped",
] as const;
export type PipelineStepStatus = (typeof PIPELINE_STEP_STATUSES)[number];

// ─── Pipeline Step Definition (stored in template JSON) ────────────────────

export type PipelineStepDef = {
  label: string;
  cliType: string;
  role: PipelineStepRole;
  /** Supports {{task}}, {{diff}}, {{previousOutput}}, {{iteration}}, {{retryFeedback}} */
  promptTemplate: string;
  allowFailure?: boolean;
  /** Step index to jump to on failure (-1 or undefined = no loop) */
  loopBackTo?: number;
  /** T58: Override access mode for this step (default: "write") */
  accessMode?: AgentAccessMode;
  /** T88v2: marks this step as a judge gate instead of a spawned agent. */
  evaluator?: EvaluatorStepDef;
};

// ─── Evaluator Gate (T88v2) ─────────────────────────────────────────────────

/** Ship if avgScore >= shipThreshold; hold (pause for a human) if it's still
 *  >= holdThreshold; otherwise retry (loop back), up to maxLoops. */
export type EvaluatorGatePolicy = {
  shipThreshold: number;
  holdThreshold: number;
};

export const DEFAULT_EVALUATOR_GATE_POLICY: EvaluatorGatePolicy = {
  shipThreshold: 0.7,
  holdThreshold: 0.4,
};

export type EvaluatorStepDef = {
  /** What "done" looks like — fed to every judge call alongside the diff. */
  acceptanceCriteria: string;
  /** Step index on ship. Undefined = advance to the next step. */
  onPassNext?: number;
  /** Step index to loop back to on retry. Undefined = pause (no loop target). */
  onFailNext?: number;
  /** Hard cap on retry loops for this gate (clamped to EVALUATOR_HARD_MAX_LOOPS). */
  maxLoops?: number;
  /** Independent judge calls per gate evaluation (score distribution). Default 3. */
  judgeCalls?: number;
  gatePolicy?: EvaluatorGatePolicy;
};

export const EVALUATOR_HARD_MAX_LOOPS = 10;

export type EvaluatorGateDecision = "ship" | "hold" | "retry";

export type EvaluatorVerdict = {
  decision: EvaluatorGateDecision;
  /** One score (0-1) per judge call — the distribution, not just an average. */
  scores: number[];
  avgScore: number;
  /** Retry guidance derived from the lowest-scoring judge's description pass;
   *  fed to the loop-back step as {{retryFeedback}}. Empty when decision !== "retry". */
  feedback: string;
  /** This gate evaluation's judge-call cost (all N calls), USD. */
  costUsd: number;
};

// ─── Pipeline Step Result (stored in run JSON) ─────────────────────────────

export type PipelineStepResult = {
  stepIndex: number;
  iteration: number;
  agentId: string | null;
  status: PipelineStepStatus;
  exitCode: number | null;
  outputSummary: string;
  diffSummary: string;
  startedAt: number | null;
  completedAt: number | null;
  /** T130 — AI-generated one-paragraph summary of diffSummary (Haiku, best-effort). */
  aiSummary?: string;
  /** T130 — the step agent's overall score (agent_scores.overall_score), if scored yet. */
  score?: number | null;
  /** T88v2 — set only for evaluator-gate steps. */
  verdict?: EvaluatorVerdict;
};

// ─── Pipeline Template ─────────────────────────────────────────────────────

export type PipelineTemplate = {
  id: string;
  projectId: string;
  name: string;
  description: string;
  steps: PipelineStepDef[];
  createdAt: number;
  updatedAt: number;
};

export type PipelineTemplateCreate = {
  projectId: string;
  name: string;
  description?: string;
  steps: PipelineStepDef[];
};

export type PipelineTemplateUpdate = {
  name?: string;
  description?: string;
  steps?: PipelineStepDef[];
};

// ─── Pipeline Run ──────────────────────────────────────────────────────────

export type PipelineRun = {
  id: string;
  templateId: string;
  projectId: string;
  status: PipelineRunStatus;
  currentStepIndex: number;
  stepResults: PipelineStepResult[];
  iterationCount: number;
  maxIterations: number;
  originalTask: string;
  worktreePath: string | null;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
};

export type PipelineRunCreate = {
  templateId: string;
  projectId: string;
  task: string;
  maxIterations?: number;
  useWorktree?: boolean;
};

// ─── Default Pipeline Presets ──────────────────────────────────────────────

export type PipelinePreset = {
  name: string;
  description: string;
  steps: PipelineStepDef[];
};

export const PIPELINE_PRESETS: PipelinePreset[] = [
  {
    name: "Implement + Review",
    description: "One agent implements, another reviews the result.",
    steps: [
      { label: "Implement", cliType: "codex", role: "implement", promptTemplate: "" },
      { label: "Review", cliType: "claude-code", role: "review", promptTemplate: "" },
    ],
  },
  {
    name: "Implement + Review + Fix Loop",
    description: "Implement, review, fix in a loop until review passes, then verify.",
    steps: [
      { label: "Implement", cliType: "codex", role: "implement", promptTemplate: "" },
      {
        label: "Review",
        cliType: "claude-code",
        role: "review",
        promptTemplate: "",
        loopBackTo: 2,
      },
      { label: "Fix", cliType: "codex", role: "fix", promptTemplate: "", loopBackTo: 1 },
      { label: "Verify", cliType: "claude-code", role: "verify", promptTemplate: "" },
    ],
  },
];

// ─── Pipeline Status Event (push) ─────────────────────────────────────────

export type PipelineStatusEvent = {
  runId: string;
  projectId: string;
  status: PipelineRunStatus;
  currentStepIndex: number;
  stepLabel: string | null;
  timestamp: number;
};
