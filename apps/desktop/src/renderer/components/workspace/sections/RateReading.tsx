import type { SpeechFeedback, SpeechRating } from "@exegol/shared";
import { cn } from "@exegol/ui";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDismiss } from "../../../hooks/use-dismiss";
import { useFittedMenu } from "../../../hooks/use-fitted-menu";
import { useRateVoice } from "../../../hooks/use-voice-feedback";

const NOTE_MAX = 500;

const RATINGS: { rating: SpeechRating; label: string; Icon: typeof ThumbsUp }[] = [
  { rating: "good", label: "Good", Icon: ThumbsUp },
  { rating: "bad", label: "Bad", Icon: ThumbsDown },
];

/** Good or bad and a note on how one reply was read aloud, to compare voices over time */
export function RateReading({
  turnId,
  text,
  agentId,
  saved,
}: {
  turnId: string;
  text: string;
  agentId: string;
  saved: SpeechFeedback | undefined;
}) {
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  const [rating, setRating] = useState<SpeechRating | null>(null);
  const [note, setNote] = useState("");
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const style = useFittedMenu(panelRef, point);
  const { rate, remove } = useRateVoice();

  const close = useCallback(() => {
    setPoint(null);
    buttonRef.current?.focus();
  }, []);
  useDismiss(panelRef, !!point, close);

  const open = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    setRating(saved?.rating ?? null);
    setNote(saved?.note ?? "");
    setPoint({ x: rect.left, y: rect.bottom + 4 });
  };
  const save = () => {
    if (!rating) return;
    rate.mutate(
      { agentId, turnId, text, rating, note: note.trim() || undefined },
      { onSuccess: close },
    );
  };
  const SavedIcon = saved?.rating === "bad" ? ThumbsDown : ThumbsUp;
  const title = saved ? `Reading marked ${saved.rating}: edit` : "Rate the reading";

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        // Own the mousedown so the outside-click close does not reopen it on the same click
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => (point ? close() : open())}
        title={title}
        aria-label={title}
        aria-haspopup="dialog"
        aria-expanded={!!point}
        className={cn(
          "rounded p-0.5 text-text-muted hover:text-text-primary",
          saved && "text-accent",
        )}
      >
        <SavedIcon className="h-3 w-3" aria-hidden="true" />
      </button>
      {point &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label="Rate the reading"
            className="fixed z-50 flex w-64 flex-col gap-2 rounded-lg border border-border bg-bg-secondary p-2.5 text-xs shadow-2xl"
            style={style}
            onKeyDown={(e) => {
              if (e.key !== "Escape") return;
              e.stopPropagation();
              close();
            }}
          >
            <p className="text-[11px] font-medium text-text-primary">How was it read?</p>
            <div className="flex gap-1.5">
              {RATINGS.map(({ rating: value, label, Icon }, i) => (
                <button
                  key={value}
                  type="button"
                  // biome-ignore lint/a11y/noAutofocus: the popover opens from the keyboard too
                  autoFocus={i === 0}
                  aria-pressed={rating === value}
                  onClick={() => setRating(value)}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-1 rounded border border-border px-2 py-1 text-text-secondary hover:text-text-primary",
                    rating === value && "border-accent bg-accent/15 text-accent",
                  )}
                >
                  <Icon className="h-3 w-3" aria-hidden="true" />
                  {label}
                </button>
              ))}
            </div>
            <textarea
              value={note}
              rows={3}
              maxLength={NOTE_MAX}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter" || !(e.metaKey || e.ctrlKey)) return;
                e.preventDefault();
                save();
              }}
              placeholder="What it said wrong"
              aria-label="Note"
              className="resize-none rounded border border-border bg-bg-primary px-2 py-1.5 text-xs text-text-primary outline-none placeholder:text-text-muted focus:border-accent"
            />
            <div className="flex items-center gap-1.5">
              {saved && (
                <button
                  type="button"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(turnId, { onSuccess: close })}
                  className="text-[11px] text-text-muted hover:text-text-primary disabled:opacity-60"
                >
                  Remove
                </button>
              )}
              <span className="flex-1" />
              <button
                type="button"
                onClick={close}
                className="rounded px-2 py-1 text-[11px] text-text-muted hover:text-text-primary"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={save}
                disabled={!rating || rate.isPending}
                className="rounded bg-accent px-2 py-1 text-[11px] text-white hover:bg-accent-hover disabled:opacity-40"
              >
                Save
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
