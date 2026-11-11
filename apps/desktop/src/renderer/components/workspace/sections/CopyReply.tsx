import { Check, Copy } from "lucide-react";
import { useState } from "react";

/** Copies one reply as the agent wrote it (its Markdown) */
export function CopyReply({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const title = copied ? "Copied" : "Copy reply";
  const Icon = copied ? Check : Copy;
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard
          .writeText(text)
          .then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          })
          .catch(() => {});
      }}
      title={title}
      aria-label={title}
      className="rounded p-0.5 text-text-muted hover:text-text-primary"
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
    </button>
  );
}
