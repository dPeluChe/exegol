import { AlertTriangle, MicOff } from "lucide-react";
import type { ReactNode } from "react";
import { useMicAction } from "../../hooks/use-trpc-dictation";
import { dismissDictation } from "../../lib/dictation/controller";
import { IS_MAC } from "../../lib/keymap";
import { useDictationStore } from "../../stores/dictation";
import { OverlayButton } from "./overlay-ui";
import { DRAG_HANDLE } from "./use-overlay-drag";

export function MicDenied() {
  const mic = useMicAction();
  return (
    <Panel icon={<MicOff className="h-4 w-4" />} title="Exegol cannot use the microphone">
      <p className="text-xs leading-relaxed text-text-secondary">
        {IS_MAC
          ? "Allow Exegol in System Settings > Privacy & Security > Microphone, then try again."
          : "The system refused the microphone. Check that one is connected and allowed."}
      </p>
      <div className="mt-3 flex justify-end gap-2">
        <OverlayButton onClick={() => dismissDictation("button")}>Close</OverlayButton>
        {IS_MAC && (
          <OverlayButton variant="primary" onClick={() => mic.mutate("openMicSettings")}>
            Open System Settings
          </OverlayButton>
        )}
      </div>
    </Panel>
  );
}

export function ErrorBody() {
  const error = useDictationStore((s) => s.error);
  return (
    <Panel icon={<AlertTriangle className="h-4 w-4" />} title="Dictation failed">
      <p className="text-xs leading-relaxed break-words text-text-secondary">{error}</p>
      <div className="mt-3 flex justify-end">
        <OverlayButton onClick={() => dismissDictation("button")}>Close</OverlayButton>
      </div>
    </Panel>
  );
}

function Panel({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 p-3.5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-error/10 text-error">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div {...DRAG_HANDLE} className="mb-1 cursor-grab text-sm font-medium text-text-primary">
          {title}
        </div>
        {children}
      </div>
    </div>
  );
}
