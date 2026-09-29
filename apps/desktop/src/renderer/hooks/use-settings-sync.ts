import { useQueryClient } from "@tanstack/react-query";
import { useMountEffect } from "./use-mount-effect";

/**
 * T120: subscribe to peer-window `settings:changed` events so the main
 * window's TanStack Query cache refetches when the standalone settings
 * window mutates a setting. Without this, theme/font/etc. changes don't
 * surface in the main window until staleTime expires.
 */
export function useSettingsSync(): void {
  const queryClient = useQueryClient();
  useMountEffect(() => {
    return window.api.settings.onChanged(() => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      // CLIs edited in Settings (enable, reorder, custom ones): the launcher read them 30s stale
      queryClient.invalidateQueries({ queryKey: ["enabledProviders"] });
      queryClient.invalidateQueries({ queryKey: ["providers"] });
      // Main also sends it after adopting project icons in the background
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    });
  });
}
