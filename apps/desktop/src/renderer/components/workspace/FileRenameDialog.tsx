import { pathBase, pathSep } from "@exegol/shared";
import * as Dialog from "@radix-ui/react-dialog";
import { useState } from "react";
import { trpcMutate } from "../../lib/trpc-client";

export function RenameDialog({
  path,
  onClose,
  onRenamed,
}: {
  path: string | null;
  onClose: () => void;
  onRenamed: (from: string, to: string) => void;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const current = path ? pathBase(path) : "";
  const dir = path ? path.slice(0, path.length - current.length) : "";

  const submit = async () => {
    const next = name.trim();
    if (!path || !next || next === current || next.includes("/") || next.includes(pathSep(path)))
      return onClose();
    try {
      await trpcMutate("files.rename", { from: path, to: `${dir}${next}` });
      onRenamed(path, `${dir}${next}`);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Dialog.Root
      open={!!path}
      onOpenChange={(open) => {
        if (open) return;
        onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <Dialog.Content
          className="fixed left-1/2 top-1/3 z-50 w-[calc(100%-2rem)] max-w-sm max-h-[85vh] overflow-y-auto -translate-x-1/2 rounded-lg border p-4 shadow-2xl"
          style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}
          onOpenAutoFocus={() => {
            setName(current);
            setError(null);
          }}
        >
          <Dialog.Title className="min-w-0 mb-2 text-sm font-semibold text-text-primary">
            Rename {current}
          </Dialog.Title>
          <input
            // biome-ignore lint/a11y/noAutofocus: the dialog exists to type a name
            autoFocus
            aria-label="New name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
            className="w-full rounded border border-border bg-bg-primary px-2 py-1 text-xs text-text-primary outline-none focus:border-accent"
          />
          {error && <p className="mt-2 text-[11px] text-red-400">{error}</p>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
