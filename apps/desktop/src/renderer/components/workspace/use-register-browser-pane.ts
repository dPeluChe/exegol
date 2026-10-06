import { useEffect } from "react";
import { webviewIdOf } from "./use-browser-qa";

/** Offer this pane's webview to its project's agents. Main checks the webview really is in that
 *  project's partition before an agent can reach it. Registers on attach, not on the first page:
 *  a slow dev server would keep the pane out of reach until it answered */
export function useRegisterBrowserPane(
  webviewRef: React.RefObject<HTMLElement | null>,
  paneId: string | null,
  projectId: string | null | undefined,
): void {
  useEffect(() => {
    const wv = webviewRef.current;
    if (!wv || !paneId || !projectId) return;
    const register = () => {
      let id: number | undefined;
      try {
        id = webviewIdOf(webviewRef);
      } catch {
        return; // not attached yet: did-attach registers it
      }
      if (id !== undefined)
        void window.api.browser.registerPane(paneId, projectId, id).catch(() => {});
    };
    register();
    wv.addEventListener("did-attach", register);
    return () => wv.removeEventListener("did-attach", register);
  }, [webviewRef, paneId, projectId]);
}
