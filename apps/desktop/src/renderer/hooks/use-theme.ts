import { useEffect } from "react";
import { useSettings } from "./use-trpc";

export function useTheme() {
  const settings = useSettings();
  const theme = settings.data?.theme ?? "dark";

  // Rule 4: external system sync — sets data-theme attribute on <html> element
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") {
      const mql = window.matchMedia("(prefers-color-scheme: dark)");
      root.setAttribute("data-theme", mql.matches ? "dark" : "light");
      const handler = (e: MediaQueryListEvent) => {
        root.setAttribute("data-theme", e.matches ? "dark" : "light");
      };
      mql.addEventListener("change", handler);
      return () => mql.removeEventListener("change", handler);
    }
    root.setAttribute("data-theme", theme);
  }, [theme]);

  return theme;
}

/** Returns the resolved theme value ("dark" or "light"), accounting for "system" preference. */
export function useThemeValue(): "dark" | "light" {
  const theme = useTheme();
  if (theme === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return theme as "dark" | "light";
}
