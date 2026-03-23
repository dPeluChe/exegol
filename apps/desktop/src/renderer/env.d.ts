/// <reference types="vite/client" />

interface AgentStatusEvent {
  agentId: string;
  projectId: string;
  status: string;
  currentStep: string | null;
  cliType: string;
  timestamp: number;
}

interface SystemMetricsEvent {
  cpu: { usage: number; cores: number; model: string };
  memory: { total: number; used: number; free: number; usagePercent: number };
  disk: { total: number; used: number; free: number; usagePercent: number };
  uptime: number;
}

interface PipelineStatusEvent {
  runId: string;
  projectId: string;
  status: string;
  currentStepIndex: number;
  stepLabel: string | null;
  timestamp: number;
}

interface Window {
  api: {
    trpc: {
      invoke: (path: string, input: unknown) => Promise<unknown>;
    };
    terminal: {
      onData: (id: string, callback: (data: string) => void) => () => void;
      write: (id: string, data: string) => void;
      resize: (id: string, cols: number, rows: number) => void;
    };
    app: {
      getVersion: () => Promise<string>;
      getPlatform: () => string;
    };
    dialog: {
      showOpenDialog: (
        options: Record<string, unknown>,
      ) => Promise<{ canceled: boolean; filePaths: string[] }>;
    };
    windowControls: {
      minimize: () => void;
      maximize: () => void;
      close: () => void;
    };
    onAgentHandoff?: (callback: (agentId: string, handoffId: string) => void) => () => void;
    onAgentStatus: (callback: (event: AgentStatusEvent) => void) => () => void;
    onPipelineStatus: (callback: (event: PipelineStatusEvent) => void) => () => void;
    onMetrics: (callback: (metrics: SystemMetricsEvent) => void) => () => void;
    onNotificationNavigate?: (callback: (data: { agentId: string }) => void) => () => void;
    updater: {
      check: () => Promise<void>;
      install: () => Promise<void>;
      onStatus: (callback: (status: unknown) => void) => () => void;
    };
  };
}
