import { Button } from "@exegol/ui";
import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Bug, ClipboardCopy, ExternalLink, FolderOpen, X } from "lucide-react";
import { useState } from "react";
import { trpcInvoke, trpcMutate } from "../../lib/trpc-client";

interface Diagnostics {
  text: string;
  version: string;
  lastError: string | null;
}

/**
 * T196: one place to turn "something broke" into an issue we can work on:
 * redacted diagnostics (logs of this and the previous sessions, sidecar log,
 * Doctor, versions), the logs folder, and a GitHub issue filed with them.
 */
export function BugReportButton() {
  const [open, setOpen] = useState(false);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          className="flex h-6 w-6 items-center justify-center rounded text-text-muted transition-colors hover:bg-white/10 hover:text-text-primary"
          title="Report a bug (logs + diagnostics)"
        >
          <Bug className="h-3.5 w-3.5" />
        </button>
      </Dialog.Trigger>
      {/* Mounted only while open: each report starts from a fresh collection */}
      {open && <BugReportDialog />}
    </Dialog.Root>
  );
}

function BugReportDialog() {
  const [description, setDescription] = useState("");
  const [showPreview, setShowPreview] = useState(true);
  const [copied, setCopied] = useState(false);
  // Collected once per dialog: copy and report reuse what the user reviewed
  const diagnostics = useQuery({
    queryKey: ["diagnostics"],
    queryFn: () => trpcInvoke<Diagnostics>("diagnostics.collect"),
    staleTime: 0,
    gcTime: 0,
  });
  const openLogs = useMutation({ mutationFn: () => trpcMutate("diagnostics.openLogs") });
  const report = useMutation({
    mutationFn: (diag: Diagnostics) =>
      trpcMutate<{ url: string; via: "gh" | "browser" }>("diagnostics.report", {
        description,
        diagnostics: diag,
      }),
  });
  const diag = diagnostics.data;

  return (
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
      <Dialog.Content
        className="fixed left-1/2 top-[8%] z-50 flex max-h-[84vh] w-full max-w-2xl -translate-x-1/2 flex-col gap-3 overflow-hidden rounded-xl border p-4 shadow-2xl"
        style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}
      >
        <div className="flex items-center gap-2">
          <Bug className="h-4 w-4 text-accent" />
          <Dialog.Title className="text-sm font-semibold text-text-primary">
            Report a bug
          </Dialog.Title>
          <Dialog.Close className="ml-auto rounded p-1 text-text-muted hover:bg-white/10 hover:text-text-primary">
            <X className="h-3.5 w-3.5" />
          </Dialog.Close>
        </div>
        <Dialog.Description className="text-[11px] text-text-muted">
          The issue is public. Exegol attaches its logs (this and the last two sessions, the
          terminal sidecar), Doctor and versions, with paths, keys, tokens, prompts and agent output
          removed. Review what is sent below before filing.
        </Dialog.Description>

        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What were you doing, what did you expect, what happened instead?"
          rows={4}
          className="w-full resize-y rounded-lg border border-border bg-bg-primary px-2 py-1.5 text-[12px] text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
        />

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            onClick={() => diag && report.mutate(diag)}
            disabled={!diag || report.isPending}
          >
            <ExternalLink className="h-3.5 w-3.5" />
            {report.isPending ? "Filing..." : "Create GitHub issue"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!diag}
            onClick={() =>
              diag &&
              navigator.clipboard
                .writeText(diag.text)
                .then(() => setCopied(true))
                .catch(() => {})
            }
          >
            <ClipboardCopy className="h-3.5 w-3.5" />
            {copied ? "Copied" : "Copy diagnostics"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => openLogs.mutate()}>
            <FolderOpen className="h-3.5 w-3.5" />
            Open logs folder
          </Button>
          <button
            type="button"
            onClick={() => setShowPreview((v) => !v)}
            className="ml-auto text-[11px] text-text-muted hover:text-text-primary"
          >
            {showPreview ? "Hide" : "Review"} what is sent
          </button>
        </div>

        {report.isSuccess && (
          <p className="rounded-lg bg-green-500/10 px-3 py-2 text-[11px] text-green-400">
            {report.data.via === "gh" ? (
              <>
                Issue created:{" "}
                <a href={report.data.url} target="_blank" rel="noreferrer" className="underline">
                  {report.data.url}
                </a>
              </>
            ) : (
              "GitHub opened with the issue prefilled. The full diagnostics are in your clipboard: paste them into the issue before submitting."
            )}
          </p>
        )}
        {report.isError && (
          <p className="rounded-lg bg-red-500/10 px-3 py-2 text-[11px] text-red-400">
            Could not file the issue: {String(report.error)}. Use "Copy diagnostics" and open an
            issue by hand.
          </p>
        )}

        {showPreview && (
          <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-bg-primary p-2 font-mono text-[10px] text-text-secondary">
            {diagnostics.isLoading ? "Collecting..." : (diag?.text ?? "Unavailable")}
          </pre>
        )}
      </Dialog.Content>
    </Dialog.Portal>
  );
}
