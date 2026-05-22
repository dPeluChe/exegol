import { Loader2, Play, Save, Send } from "lucide-react";
import {
  exportToPlaywright,
  formatRecordingForAgent,
  type QaRecording,
} from "../../lib/qa-recorder";

interface RunningAgent {
  id: string;
  cliType: string;
}

interface BrowserQaRecordingBarProps {
  qaRecording: QaRecording;
  replaying: boolean;
  replayStep: number;
  stopOnFail: boolean;
  testName: string;
  savingTest: boolean;
  projectId: string | null;
  runningAgents: RunningAgent[];
  onReplay: () => void;
  onCancelReplay: () => void;
  onSendToAgent: (agentId: string, text: string) => void;
  onSetStopOnFail: (v: boolean) => void;
  onSetTestName: (v: string) => void;
  onSaveTest: () => void;
  onDismiss: () => void;
}

export function BrowserQaRecordingBar({
  qaRecording,
  replaying,
  replayStep,
  stopOnFail,
  testName,
  savingTest,
  projectId,
  runningAgents,
  onReplay,
  onCancelReplay,
  onSendToAgent,
  onSetStopOnFail,
  onSetTestName,
  onSaveTest,
  onDismiss,
}: BrowserQaRecordingBarProps) {
  return (
    <div className="shrink-0 border-t border-border bg-red-500/5 px-3 py-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-medium text-red-300">
          Recorded: {qaRecording.actions.length} actions
          {qaRecording.consoleErrors.length > 0 && ` · ${qaRecording.consoleErrors.length} errors`}
          {replaying && ` · Replaying step ${replayStep + 1}/${qaRecording.actions.length}...`}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onReplay}
            disabled={replaying}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] text-green-300 hover:bg-green-500/10 disabled:opacity-50"
            title="Replay this recording in the browser"
          >
            {replaying ? (
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
            ) : (
              <Play className="h-2.5 w-2.5" />
            )}
            {replaying ? "Running..." : "Run"}
          </button>
          {replaying && (
            <button
              type="button"
              onClick={onCancelReplay}
              className="rounded px-1.5 py-0.5 text-[9px] text-amber-300 hover:bg-amber-500/10"
            >
              Cancel
            </button>
          )}
          {runningAgents.length > 0 ? (
            runningAgents.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => onSendToAgent(a.id, formatRecordingForAgent(qaRecording))}
                className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] text-red-300 hover:bg-red-500/10"
                title={`Send to ${a.cliType}`}
              >
                <Send className="h-2.5 w-2.5" /> {a.cliType}
              </button>
            ))
          ) : (
            <button
              type="button"
              onClick={() => navigator.clipboard.writeText(formatRecordingForAgent(qaRecording))}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] text-text-muted hover:bg-white/5"
            >
              <Send className="h-2.5 w-2.5" /> Copy
            </button>
          )}
          <button
            type="button"
            onClick={() => navigator.clipboard.writeText(exportToPlaywright(qaRecording))}
            className="rounded px-1.5 py-0.5 text-[9px] text-text-muted hover:bg-white/5"
          >
            Playwright
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="rounded px-1.5 py-0.5 text-[9px] text-text-muted hover:bg-white/5"
          >
            Dismiss
          </button>
        </div>
      </div>
      {/* Stop-on-fail toggle */}
      <div className="mt-1 flex items-center gap-1.5">
        <label className="flex cursor-pointer items-center gap-1 text-[9px] text-text-muted">
          <input
            type="checkbox"
            checked={stopOnFail}
            onChange={(e) => onSetStopOnFail(e.target.checked)}
            className="h-2.5 w-2.5 accent-accent"
          />
          Stop on fail
        </label>
      </div>
      {/* Save test row */}
      {projectId && (
        <div className="mt-1 flex items-center gap-1.5">
          <input
            type="text"
            value={testName}
            onChange={(e) => onSetTestName(e.target.value)}
            placeholder="Test name..."
            className="flex-1 rounded border border-border bg-bg-secondary px-2 py-0.5 text-[10px] text-text-primary outline-none placeholder:text-text-muted focus:border-accent/50"
            onKeyDown={(e) => {
              if (e.key === "Enter") onSaveTest();
            }}
          />
          <button
            type="button"
            onClick={onSaveTest}
            disabled={!testName.trim() || savingTest}
            className="flex items-center gap-1 rounded bg-accent/10 px-2 py-0.5 text-[9px] text-accent hover:bg-accent/20 disabled:opacity-50"
          >
            <Save className="h-2.5 w-2.5" />
            {savingTest ? "Saving..." : "Save Test"}
          </button>
        </div>
      )}
    </div>
  );
}
