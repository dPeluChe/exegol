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
  /** T123: unix epoch ms — set when a hook/OSC signal reports a new turn boundary. */
  turnStarted?: number;
  /** T123: unix epoch ms — set when a hook/OSC signal reports a turn completed. */
  turnEnded?: number;
  /** T123: true when the agent is waiting on the user (drives T141 attention inbox). */
  needsAttention?: boolean;
  /** A terminal's session became an agent: its new name, and that it runs over a shell */
  alias?: string | null;
  launchedInShell?: boolean;
  /** When the status last changed (ms), durable across app restarts */
  statusChangedAt?: number;
}

interface SystemMetricsEvent {
  cpu: { usage: number; cores: number; model: string };
  memory: { total: number; used: number; free: number; usagePercent: number };
  disk: { total: number; used: number; free: number; usagePercent: number };
  uptime: number;
  usage?: {
    exegolCpu: number;
    exegolMemory: number;
    agentsCpu: number;
    agentsMemory: number;
    agentProcesses: number;
  } | null;
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
      getSnapshot: (id: string) => Promise<string | null>;
      hasContent: (id: string) => Promise<boolean>;
      /** T178: report whether this view can draw the agent. A repaint, when one
       *  is needed, arrives on terminal:data so it stays ordered. */
      setVisible: (id: string, visible: boolean, viewId: string, fresh?: boolean) => Promise<void>;
      redraw: (id: string) => void;
      clear: (id: string) => void;
      getSize: (id: string) => Promise<{ cols: number; rows: number } | null>;
      onResized: (id: string, callback: (cols: number, rows: number) => void) => () => void;
      saveClipboardImage: () => Promise<string | null>;
    };
    app: {
      getVersion: () => Promise<string>;
      getPlatform: () => string;
    };
    onMenuAction: (
      callback: (
        action: "new-tab" | "close-pane" | "reload" | "focus-location" | "open-dashboard",
      ) => void,
    ) => () => void;
    onPaneSwitcherKey: (
      callback: (key: { kind: "tab" | "release"; shift?: boolean }) => void,
    ) => () => void;
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
    pathForFile?: (file: File) => string;
    onAgentStatus: (callback: (event: AgentStatusEvent) => void) => () => void;
    onPrWatch: (
      callback: (event: { agentId: string; projectId: string; reason?: string }) => void,
    ) => () => void;
    onCliSelfUpdated: (
      callback: (event: import("./stores/cli-self-updates").CliSelfUpdate) => void,
    ) => () => void;
    onResumeMissed: (
      callback: (event: { agentId: string; projectId: string; cliType: string }) => void,
    ) => () => void;
    /** Exegol gained or lost the focus (another app took it; not a webview or our own windows) */
    onWindowFocus: (callback: (focused: boolean) => void) => () => void;
    onPipelineStatus: (callback: (event: PipelineStatusEvent) => void) => () => void;
    /** T200.5: an agent's turn changes were recorded or undone */
    onTurnChanges: (callback: (event: { agentId: string }) => void) => () => void;
    /** Startup reattach progress (each session back, then done) */
    onRecoveryProgress: (
      callback: (state: import("@exegol/shared").SessionRecoveryState) => void,
    ) => () => void;
    onMetrics: (callback: (metrics: SystemMetricsEvent) => void) => () => void;
    dictation: {
      sendAudio: (sessionId: string, samples: Float32Array) => void;
      markBrowser: (input: { paneId: string; projectId: string }) => Promise<boolean>;
      insertInBrowser: (input: {
        paneId: string;
        projectId: string;
        text: string;
      }) => Promise<boolean>;
      onPartial: (
        callback: (event: import("@exegol/shared").DictationPartialEvent) => void,
      ) => () => void;
      onEngine: (
        callback: (event: { state: import("@exegol/shared").DictationEngineState }) => void,
      ) => () => void;
      onKey: (
        callback: (
          event:
            | { kind: "down" | "up" | "escape" | "enter" }
            | { kind: "limit"; sessionId: string; maxSeconds: number },
        ) => void,
      ) => () => void;
      onDone: (callback: () => void) => () => void;
    };
    onSidecarHealth: (
      callback: (event: import("@exegol/shared").SidecarHealth) => void,
    ) => () => void;
    onModelProgress: (
      callback: (event: import("@exegol/shared").ModelProgressEvent) => void,
    ) => () => void;
    /** T200.4: an agent's follow-up queue changed */
    onFollowUps: (
      callback: (event: import("@exegol/shared").FollowUpsChangedEvent) => void,
    ) => () => void;
    onNotificationNavigate?: (callback: (data: { agentId: string }) => void) => () => void;
    /** Toggle the app's own DevTools (TitleBar button) */
    toggleDevTools?: () => void;
    reportError?: (source: string, message: string, stack: string) => void;
    onDeepLinkOpenPath?: (callback: (data: { path: string }) => void) => () => void;
    updater: {
      check: () => Promise<void>;
      install: () => Promise<void>;
      onStatus: (callback: (status: unknown) => void) => () => void;
    };
    // T102: Design Mode + QA — browser pane inspection
    browser: {
      /** `webContentsId`: the pane's own webview; without it the window's first one */
      executeJs: (code: string, webContentsId?: number) => Promise<unknown>;
      captureScreenshot: (webContentsId?: number) => Promise<string | null>;
      registerPane: (paneId: string, projectId: string, webContentsId: number) => Promise<boolean>;
      control: (paneId: string, action: "take-over" | "hand-back") => Promise<boolean>;
      agentStates: () => Promise<import("@exegol/shared").AgentBrowserPaneState[]>;
      onAgentState: (
        callback: (state: import("@exegol/shared").AgentBrowserPaneState) => void,
      ) => () => void;
      onOpenRequest: (
        callback: (req: {
          requestId: string;
          projectId: string;
          agentId: string;
          url: string;
        }) => void,
      ) => () => void;
      openResult: (result: { requestId: string; paneId?: string; error?: string }) => Promise<void>;
    };
    onPreviewLink: (
      callback: (link: { from: string; url: string; host: string; dropped: boolean }) => void,
    ) => () => void;
    onMcpStatus: (callback: (event: import("@exegol/shared").McpStatusEvent) => void) => () => void;
    floating: {
      open: (config: {
        paneId: string;
        type: "terminal" | "browser";
        title: string;
        agentId?: string;
        url?: string;
        projectId?: string;
        viewport?: string;
        inactive?: boolean;
      }) => Promise<void>;
      close: (paneId: string) => Promise<void>;
      selfClose: () => void;
      selfToggleDevTools: () => void;
      reportPage: (url: string) => void;
      onClosed: (callback: (paneId: string, page?: string) => void) => () => void;
    };
    // T120: Settings as a separate BrowserWindow
    settings: {
      open: (
        tab?:
          | "general"
          | "statusbar"
          | "clis"
          | "terminal"
          | "shortcuts"
          | "apikeys"
          | "models"
          | "dictation"
          | "storage",
      ) => Promise<void>;
      selfClose: () => void;
      showDashboard: () => void;
      onNavigate: (callback: (tab: string) => void) => () => void;
      broadcastChanged: () => void;
      onChanged: (callback: () => void) => () => void;
    };
  };
}
