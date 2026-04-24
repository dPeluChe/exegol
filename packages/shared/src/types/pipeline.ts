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
  /** Supports {{task}}, {{diff}}, {{previousOutput}}, {{iteration}} */
  promptTemplate: string;
  allowFailure?: boolean;
  /** Step index to jump to on failure (-1 or undefined = no loop) */
  loopBackTo?: number;
  /** T58: Override access mode for this step (default: "write") */
  accessMode?: AgentAccessMode;
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
