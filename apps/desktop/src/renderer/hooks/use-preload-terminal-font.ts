import { useEffect } from "react";
import { useSettings } from "./use-trpc";

/** The bundled terminal fonts load on first use: a terminal measured before that fits the
 *  fallback's cells, then refits ~40 ms later (`settled 130x57 -> 137x57`). Fetch it at startup */
export function usePreloadTerminalFont(): void {
  const { data: settings } = useSettings();
  const font = settings
    ? `${settings.terminalFontSize ?? 14}px ${settings.terminalFontFamily ?? "Menlo, Monaco, monospace"}`
    : null;
  useEffect(() => {
    if (!font || typeof document === "undefined" || !document.fonts) return;
    try {
      document.fonts.load(font).catch(() => {});
    } catch {
      // Not a valid CSS font shorthand: terminals fall back to refitWhenFontLoads
    }
  }, [font]);
}
