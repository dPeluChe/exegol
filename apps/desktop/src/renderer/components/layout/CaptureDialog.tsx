import type { CaptureLink } from "@exegol/shared";
import { Button, cn } from "@exegol/ui";
import * as Dialog from "@radix-ui/react-dialog";
import { useMemo, useState } from "react";
import { useAct } from "../../hooks/use-act";
import { useColabs } from "../../hooks/use-inbox";
import { useMountEffect } from "../../hooks/use-mount-effect";
import { useProjects } from "../../hooks/use-trpc";
import { useToastStore } from "../../stores/toasts";
import { INPUT_CLASS } from "../agents/SpawnOptions";
import type { ProjectMeta } from "../common/ProjectChip";
import { inboxTargetOf, inboxTargets } from "../workspace/sections/InboxMoreActions";

/** `exegol://capture` fills this; nothing is kept until the person picks a place and saves */
export function CaptureDialog() {
  const [captured, setCaptured] = useState<CaptureLink | null>(null);
  useMountEffect(() => window.api.onDeepLinkCapture?.(setCaptured));
  if (!captured) return null;
  return (
    <CaptureForm
      key={JSON.stringify(captured)}
      captured={captured}
      onClose={() => setCaptured(null)}
    />
  );
}

function CaptureForm({ captured, onClose }: { captured: CaptureLink; onClose: () => void }) {
  const { data: projects } = useProjects();
  const colabs = useColabs();
  const projectMeta = useMemo(
    () =>
      new Map<string, ProjectMeta>(
        (projects ?? []).map((p) => [p.id, { name: p.name, color: p.color ?? null }]),
      ),
    [projects],
  );
  const [to, setTo] = useState("personal");
  const [note, setNote] = useState("");
  const { busy, act } = useAct("Not captured");
  const save = async () => {
    const done = await act("inbox.capture", {
      target: inboxTargetOf(to),
      ...captured,
      note: note.trim() || null,
    });
    if (!done) return;
    useToastStore.getState().addToast({ type: "success", title: "Captured to the inbox" });
    onClose();
  };
  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <Dialog.Content
          className="fixed left-1/2 top-[12vh] z-50 flex max-h-[76vh] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 flex-col gap-2 rounded-lg border p-4 shadow-2xl"
          style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}
        >
          <Dialog.Title className="text-sm font-semibold text-text-primary">
            Capture to the inbox
          </Dialog.Title>
          <Dialog.Description className="text-[11px] text-text-muted">
            Sent from outside Exegol. Nothing is saved or opened until you pick a place.
          </Dialog.Description>
          <div className="min-h-0 overflow-y-auto rounded border border-border p-2 text-[11px] text-text-secondary">
            {captured.title && <p className="font-medium text-text-primary">{captured.title}</p>}
            {captured.url && <p className="break-all font-mono">{captured.url}</p>}
            {captured.text && <p className="whitespace-pre-wrap">{captured.text}</p>}
          </div>
          <select value={to} onChange={(e) => setTo(e.target.value)} className={INPUT_CLASS}>
            {inboxTargets(null, projectMeta, colabs).map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            placeholder="A line of your own (optional)"
            className={cn(INPUT_CLASS, "min-w-0")}
          />
          <div className="flex justify-end gap-1.5">
            <Button size="sm" variant="ghost" onClick={onClose}>
              Discard
            </Button>
            <Button size="sm" disabled={busy} onClick={() => void save()}>
              Save
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
