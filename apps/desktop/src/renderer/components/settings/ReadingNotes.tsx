import { cn } from "@exegol/ui";
import { Copy, ThumbsDown, ThumbsUp } from "lucide-react";
import { useState } from "react";
import { useVoiceFeedbackList } from "../../hooks/use-voice-feedback";
import { feedbackDate, feedbackMarkdown, ratingLabel } from "../../lib/speech-feedback";

/** Settings > Models > Voice: the person's marks on how replies were read, newest first */
export function ReadingNotes() {
  const { data = [], isLoading } = useVoiceFeedbackList();
  const [copied, setCopied] = useState<unknown>(null);
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <h4 className="flex-1 text-xs font-semibold text-text-primary">Reading notes</h4>
        {data.length > 0 && (
          <button
            type="button"
            onClick={() =>
              void navigator.clipboard
                .writeText(feedbackMarkdown(data))
                .then(() => setCopied(data))
                .catch(() => {})
            }
            className="flex items-center gap-1 text-[11px] text-text-muted hover:text-text-primary"
          >
            <Copy className="h-3 w-3" aria-hidden="true" />
            {copied === data ? "Copied" : "Copy as Markdown"}
          </button>
        )}
      </div>
      {!isLoading && data.length === 0 && (
        <p className="text-[11px] text-text-muted">
          No notes yet. Rate a reading from the Commander's chat.
        </p>
      )}
      <ul className="space-y-1.5">
        {data.map((entry) => {
          const Icon = entry.rating === "good" ? ThumbsUp : ThumbsDown;
          return (
            <li key={entry.id} className="rounded border border-border px-2.5 py-1.5 text-[11px]">
              <div className="flex items-center gap-1.5 text-text-muted">
                <Icon
                  className={cn(
                    "h-3 w-3",
                    entry.rating === "good" ? "text-accent" : "text-warning",
                  )}
                  aria-label={ratingLabel(entry.rating)}
                />
                <span>{feedbackDate(entry.at)}</span>
                <span>
                  · {entry.voice} at {entry.speed}x
                </span>
              </div>
              {entry.note && (
                <p className="mt-0.5 whitespace-pre-wrap break-words text-text-secondary">
                  {entry.note}
                </p>
              )}
              <details className="mt-0.5">
                <summary className="cursor-pointer text-text-muted hover:text-text-primary">
                  Spoken text
                </summary>
                <p className="mt-1 whitespace-pre-wrap break-words text-text-muted">
                  {entry.spoken}
                </p>
              </details>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
