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
    });
  });
}
