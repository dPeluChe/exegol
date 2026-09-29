import type { QueryClient } from "@tanstack/react-query";

/** Every CLI change: refresh both windows (the launcher read providers 30s stale) and say why it
 *  failed instead of swallowing it */
export async function mutateCli(
  queryClient: QueryClient,
  run: () => Promise<unknown>,
  onError: (message: string) => void,
): Promise<boolean> {
  try {
    await run();
    queryClient.invalidateQueries({ queryKey: ["providers"] });
    queryClient.invalidateQueries({ queryKey: ["enabledProviders"] });
    window.api.settings.broadcastChanged();
    return true;
  } catch (err) {
    onError(err instanceof Error ? err.message : String(err));
    return false;
  }
}
