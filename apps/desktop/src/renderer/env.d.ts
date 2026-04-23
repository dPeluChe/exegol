/// <reference types="vite/client" />

interface AgentStatusEvent {
  agentId: string;
  projectId: string;
  status: string;
  currentStep: string | null;
  cliType: string;
  timestamp: number;
  /** T101: Claude session ID, set once when first parsed from startup output. */
  claudeSessionId?: string;
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

interface BrowserElementInfo {
  selector: string;
  tagName: string;
  text: string;
  html: string;
  rect: { x: number; y: number; width: number; height: number };
  styles: {
    color: string;
    backgroundColor: string;
    fontSize: string;
    fontFamily: string;
    padding: string;
    margin: string;
  };
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
      getSnapshot: (id: string) => Promise<string | null>;
      saveClipboardImage: () => Promise<string | null>;
    };
    app: {
      getVersion: () => Promise<string>;
      getPlatform: () => string;
    };
    onMenuAction: (callback: (action: "new-tab" | "close-pane") => void) => () => void;
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
    // T102: Design Mode + QA — browser pane inspection
    browser: {
      executeJs: (code: string) => Promise<unknown>;
      captureScreenshot: () => Promise<string | null>;
      captureElement: (selector: string) => Promise<BrowserElementInfo | null>;
    };
    floating: {
      open: (config: {
        paneId: string;
        type: "terminal" | "browser";
        title: string;
        agentId?: string;
        url?: string;
      }) => Promise<void>;
      close: (paneId: string) => Promise<void>;
      selfClose: () => void;
      selfToggleDevTools: () => void;
      onClosed: (callback: (paneId: string) => void) => () => void;
    };
  };
}
