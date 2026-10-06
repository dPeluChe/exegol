import { useRef, useState } from "react";
import { useFileContent, useTerminalLinkFile } from "../../hooks/use-trpc";
import { trpcMutate } from "../../lib/trpc-client";
import {
  closeTerminalPeek,
  type TerminalLinkPeek as LinkPeek,
  useTerminalLinkStore,
} from "../../stores/terminal-links";
import { toastError } from "../../stores/toasts";
import { ConfirmDialog } from "../common/ConfirmDialog";
import { FileExplorer } from "../workspace/FileExplorer";
import { FilePreview } from "../workspace/FilePreview";

/**
 * The project's files beside a terminal, for a quick look or a drag into it (a file dropped on
 * the terminal types its path). A click shows the file over the terminal (PeekFileOverlay),
 * never a new tab; X or Esc closes.
 */
export function FilesPeek({
  projectId,
  rootPath,
  onOpenFile,
  onClose,
}: {
  projectId: string;
  rootPath: string;
  onOpenFile: (path: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="flex w-72 shrink-0 flex-col border-l border-border bg-bg-secondary">
      <FileExplorer
        rootPath={rootPath}
        projectId={projectId}
        onOpenFile={onOpenFile}
        onClose={onClose}
      />
    </div>
  );
}

/** The file picked in the peek, over the terminal's space; the terminal stays mounted below */
export function PeekFileOverlay({
  path,
  onClose,
  onDirtyChange,
}: {
  path: string;
  onClose: () => void;
  /** The panel's Esc leaves unsaved edits alone */
  onDirtyChange: (dirty: boolean) => void;
}) {
  const { data, error } = useFileContent(path);
  // Only read when closing: a ref, so each keystroke's dirty report does not re-render
  const dirtyRef = useRef(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const requestClose = () => (dirtyRef.current ? setConfirmClose(true) : onClose());
  return (
    <div className="absolute inset-0 z-10 flex bg-bg-primary" data-peek-file>
      <FilePreview
        key={path}
        path={path}
        file={data}
        error={error}
        onClose={requestClose}
        onDirtyChange={(d) => {
          dirtyRef.current = d;
          onDirtyChange(d);
        }}
      />
      <ConfirmDialog
        open={confirmClose}
        onOpenChange={setConfirmClose}
        title="Discard unsaved changes?"
        description="The edits to this file are not saved."
        confirmLabel="Discard"
        variant="destructive"
        onConfirm={onClose}
      />
    </div>
  );
}

/** A file clicked in this session's terminal, read-only over it (any folder the session printed) */
export function TerminalLinkPeek({ agentId }: { agentId: string }) {
  const peek = useTerminalLinkStore((s) => s.peeks[agentId]);
  if (!peek) return null;
  return <LinkFileOverlay key={`${peek.text}:${peek.line ?? ""}`} agentId={agentId} peek={peek} />;
}

function LinkFileOverlay({ agentId, peek }: { agentId: string; peek: LinkPeek }) {
  const source = { agentId, cwd: peek.cwd, text: peek.text };
  const { data, error } = useTerminalLinkFile(source);
  const open = (how: "reveal" | "external") =>
    trpcMutate("terminalLinks.open", { ...source, how }).catch(
      toastError("Could not open the file"),
    );
  return (
    <div className="absolute inset-0 z-10 flex bg-bg-primary" data-peek-file>
      <FilePreview
        path={data?.path ?? peek.text}
        file={data}
        error={error}
        revealLine={peek.line}
        readOnly
        onClose={() => closeTerminalPeek(agentId)}
        onOpenExternal={() => open("external")}
        onReveal={() => open("reveal")}
      />
    </div>
  );
}
