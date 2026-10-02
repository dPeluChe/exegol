import type { AgentProvider } from "@exegol/shared";
import { FileCode, Plus } from "lucide-react";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useFittedMenu } from "../../hooks/use-fitted-menu";
import { useLaunchableProviders } from "../../hooks/use-providers";
import { AgentIcon } from "../common/AgentIcon";
import { SpawnAgentModal } from "./SpawnAgentModal";

// ─── Agent Launcher ─────────────────────────────────────────────────────────

interface AgentLauncherProps {
  projectId: string;
}

export function AgentLauncher({ projectId }: AgentLauncherProps) {
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const [showSpawnModal, setShowSpawnModal] = useState(false);
  const [modalProvider, setModalProvider] = useState<AgentProvider | undefined>(undefined);
  const menuRef = useRef<HTMLDivElement>(null);
  const providers = useLaunchableProviders();
  const menuStyle = useFittedMenu(menuRef, anchor);
  const menuOpen = anchor !== null;
  const closeMenu = () => setAnchor(null);

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          const rect = e.currentTarget.getBoundingClientRect();
          setAnchor(menuOpen ? null : { x: rect.left, y: rect.bottom + 4 });
        }}
        className="flex h-5 w-5 items-center justify-center rounded text-text-muted transition-colors hover:bg-accent/20 hover:text-accent"
        title="Launch agent"
      >
        <Plus className="h-3 w-3" />
      </button>

      {/* Portal menu — renders at document root to avoid overflow clipping */}
      {menuOpen &&
        createPortal(
          <>
            {/* Backdrop */}
            <div
              className="fixed inset-0 z-[100]"
              onClick={closeMenu}
              onKeyDown={() => {}}
              role="none"
            />
            {/* Menu */}
            <div
              ref={menuRef}
              className="fixed z-[101] w-80 rounded-lg border border-border bg-bg-secondary p-1 shadow-2xl"
              style={menuStyle}
            >
              <div className="px-2 py-1">
                <span className="text-[9px] font-semibold uppercase tracking-wider text-text-muted">
                  Launch Agent
                </span>
              </div>
              {/* New Task — opens modal with full options */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  closeMenu();
                  setModalProvider(undefined);
                  setShowSpawnModal(true);
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent/10 text-accent"
              >
                <FileCode className="h-4 w-4" />
                <span className="font-semibold">New Task...</span>
              </button>
              <div className="my-1 h-px bg-border" />
              <div className="grid grid-cols-2 gap-px">
                {providers.map((provider) => (
                  <button
                    key={provider.id}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      closeMenu();
                      setModalProvider(provider);
                      setShowSpawnModal(true);
                    }}
                    className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-white/5"
                  >
                    <AgentIcon
                      provider={provider.id}
                      size={20}
                      fallback={provider.icon}
                      fallbackColor={provider.color}
                    />
                    <span className="truncate font-medium text-text-primary">{provider.name}</span>
                  </button>
                ))}
              </div>
            </div>
          </>,
          document.body,
        )}

      {/* Spawn Agent Modal — full task form with worktree options */}
      {showSpawnModal && (
        <SpawnAgentModal
          projectId={projectId}
          onClose={() => setShowSpawnModal(false)}
          initialProvider={modalProvider}
        />
      )}
    </>
  );
}
