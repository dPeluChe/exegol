import { pathParent, relPathBelow } from "@exegol/shared";
import {
  Copy,
  ExternalLink,
  FilePlus,
  FolderPlus,
  FolderSearch,
  Pencil,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useRef } from "react";
import { useFittedMenu } from "../../hooks/use-fitted-menu";
import { fileManagerLabel } from "../../lib/keymap";
import { trpcMutate } from "../../lib/trpc-client";

export interface ContextMenuState {
  x: number;
  y: number;
  targetPath: string;
  isDirectory: boolean;
}

export function FileContextMenu({
  menu,
  rootPath,
  onClose,
  onRequestDelete,
  onRequestRename,
  onStartCreate,
}: {
  menu: ContextMenuState;
  rootPath: string;
  onClose: () => void;
  onRequestDelete: (path: string) => void;
  onRequestRename: (path: string) => void;
  onStartCreate: (parentDir: string, type: "file" | "folder") => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("mousedown", handleClick);
    return () => window.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  const handleCreate = useCallback(
    (type: "file" | "folder") => {
      const parentDir = menu.isDirectory ? menu.targetPath : pathParent(menu.targetPath);
      onClose();
      onStartCreate(parentDir, type);
    },
    [menu, onClose, onStartCreate],
  );

  // The explorer asks (a blocking window.confirm froze the renderer's IPC)
  const handleDelete = useCallback(() => {
    onRequestDelete(menu.targetPath);
    onClose();
  }, [menu, onClose, onRequestDelete]);

  const menuStyle = useFittedMenu(menuRef, menu);
  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[140px] rounded-md border py-1 shadow-xl"
      style={{
        ...menuStyle,
        background: "var(--bg-secondary)",
        borderColor: "var(--border)",
      }}
    >
      {(
        [
          [
            "Open with default app",
            ExternalLink,
            () => trpcMutate("files.openExternal", { path: menu.targetPath }),
          ],
          [
            `Reveal in ${fileManagerLabel()}`,
            FolderSearch,
            () => trpcMutate("files.reveal", { path: menu.targetPath }),
          ],
          ["Copy path", Copy, () => navigator.clipboard.writeText(menu.targetPath)],
          [
            "Copy relative path",
            Copy,
            () =>
              navigator.clipboard.writeText(
                relPathBelow(menu.targetPath, rootPath) ?? menu.targetPath,
              ),
          ],
          ["Rename", Pencil, () => onRequestRename(menu.targetPath)],
        ] as const
      ).map(([label, Icon, run]) => (
        <button
          key={label}
          type="button"
          onClick={() => {
            onClose();
            Promise.resolve(run()).catch((err) =>
              console.error(`[FileExplorer] ${label} failed:`, err),
            );
          }}
          className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-text-secondary hover:bg-white/10"
        >
          <Icon className="h-3.5 w-3.5" /> {label}
        </button>
      ))}
      <div className="my-1 border-t" style={{ borderColor: "var(--border)" }} />
      <button
        type="button"
        onClick={() => handleCreate("file")}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-text-secondary hover:bg-white/10"
      >
        <FilePlus className="h-3.5 w-3.5" /> New File
      </button>
      <button
        type="button"
        onClick={() => handleCreate("folder")}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-text-secondary hover:bg-white/10"
      >
        <FolderPlus className="h-3.5 w-3.5" /> New Folder
      </button>
      <div className="my-1 border-t" style={{ borderColor: "var(--border)" }} />
      <button
        type="button"
        onClick={handleDelete}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-red-400 hover:bg-white/10"
      >
        <Trash2 className="h-3.5 w-3.5" /> Delete
      </button>
    </div>
  );
}

// ─── FileExplorer ──────────────────────────────────────────────────────────
