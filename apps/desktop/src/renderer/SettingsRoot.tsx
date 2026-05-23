import { TooltipProvider } from "@exegol/ui";
import { useEffect, useState } from "react";
import { SettingsPanel, type SettingsTab } from "./components/settings/SettingsPanel";
import { useTheme } from "./hooks/use-theme";

const VALID_TABS: SettingsTab[] = ["general", "clis", "terminal", "shortcuts", "apikeys"];

function parseTab(): SettingsTab | undefined {
  const raw = new URLSearchParams(window.location.search).get("settingsTab");
  return raw && (VALID_TABS as string[]).includes(raw) ? (raw as SettingsTab) : undefined;
}

/**
 * T120: top-level component for the standalone settings BrowserWindow.
 *
 * IPC `settings:navigate` triggers a key-based remount of SettingsPanel so the
 * incoming tab becomes the new initial state — without locking in-window tab
 * clicks (see review finding #1).
 */
export function SettingsRoot() {
  useTheme();
  const [tab, setTab] = useState<SettingsTab | undefined>(() => parseTab());

  useEffect(() => {
    return window.api.settings.onNavigate((next) => {
      if ((VALID_TABS as string[]).includes(next)) setTab(next as SettingsTab);
    });
  }, []);

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-screen w-screen flex-col bg-bg-primary">
        <SettingsPanel
          key={tab ?? "default"}
          initialTab={tab}
          onClose={() => window.api.settings.selfClose()}
        />
      </div>
    </TooltipProvider>
  );
}

export default SettingsRoot;
