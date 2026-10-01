import { Check, Copy } from "lucide-react";
import { useState } from "react";

/** A vendor command to paste in a terminal, one click to copy */
export function CopyCommand({ label, command }: { label: string; command: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() =>
        navigator.clipboard
          .writeText(command)
          .then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          })
          .catch(() => {})
      }
      className="mt-1 flex w-full min-w-0 items-center gap-1.5 rounded bg-bg-primary px-2 py-1 text-left font-mono text-[10px] text-text-secondary hover:text-text-primary"
      title={`${label}: click to copy`}
    >
      {copied ? (
        <Check className="h-3 w-3 shrink-0 text-success" />
      ) : (
        <Copy className="h-3 w-3 shrink-0 text-text-muted" />
      )}
      <span className="min-w-0 truncate">{command}</span>
    </button>
  );
}
