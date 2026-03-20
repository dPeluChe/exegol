import { useRef, useState } from "react";
import { useMountEffect } from "../../../../hooks/use-mount-effect";

export function AddTaskInline({
  onAdd,
  onCancel,
}: {
  onAdd: (text: string, tags: string[]) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useMountEffect(() => {
    inputRef.current?.focus();
  });

  const handleSubmit = () => {
    if (!text.trim()) return;
    // Extract inline tags
    const tags: string[] = [];
    const cleaned = text.replace(/#([\w-]+)/g, (_, tag) => {
      tags.push(tag);
      return "";
    });
    onAdd(cleaned.trim(), tags);
    setText("");
  };

  return (
    <div className="flex items-center gap-1 rounded-lg border border-accent/30 bg-bg-primary p-1.5">
      <input
        ref={inputRef}
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleSubmit();
          if (e.key === "Escape") onCancel();
        }}
        placeholder="Task description #tag"
        className="flex-1 bg-transparent text-[10px] text-text-primary outline-none placeholder:text-text-muted"
      />
      <button
        type="button"
        onClick={handleSubmit}
        className="rounded bg-accent/20 px-2 py-0.5 text-[9px] text-accent hover:bg-accent/30"
      >
        Add
      </button>
    </div>
  );
}
