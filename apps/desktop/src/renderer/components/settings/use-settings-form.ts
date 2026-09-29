import type { Settings } from "@exegol/shared";
import { useCallback, useRef, useState } from "react";
import { useSettings, useUpdateSettings } from "../../hooks/use-trpc";

/** The settings form: a local copy that auto-saves each change and flashes "Saved". */
export function useSettingsForm() {
  const { data: settings, isLoading } = useSettings();
  const updateSettings = useUpdateSettings();

  // ── Auto-save feedback indicator ──────────────────────────────────────
  const [showSaved, setShowSaved] = useState(false);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const flashSaved = useCallback(() => {
    setShowSaved(true);
    clearTimeout(savedTimerRef.current);
    savedTimerRef.current = setTimeout(() => setShowSaved(false), 1500);
  }, []);

  // Derive initial form state from settings (Rule 1: derive, don't sync)
  const [form, setForm] = useState<Settings | null>(() => settings ?? null);

  // If settings loaded after initial render (async), initialize form from it
  if (settings && !form) {
    setForm(settings);
  }

  // Auto-save on every change (General + Terminal tabs)
  const updateField = (updates: Partial<Settings>) => {
    setForm((prev) => (prev ? { ...prev, ...updates } : prev));
    // Send only the changed fields: the whole form is a mount-time snapshot and
    // would revert settings saved elsewhere (MCP verbose, notification mutes)
    updateSettings.mutate(updates, {
      onSuccess: () => flashSaved(),
      onError: (err) => {
        console.error("[Settings] Auto-save failed:", err);
        // Refused (e.g. a hotkey another app owns): the fields go back to what is saved
        if (settings) {
          const saved = Object.fromEntries(
            Object.keys(updates).map((k) => [k, settings[k as keyof Settings]]),
          ) as Partial<Settings>;
          setForm((prev) => (prev ? { ...prev, ...saved } : prev));
        }
      },
    });
  };

  const saveError = updateSettings.isError
    ? updateSettings.error instanceof Error
      ? updateSettings.error.message
      : "Unknown error"
    : null;

  return { form, isLoading, updateField, showSaved, saveError };
}
