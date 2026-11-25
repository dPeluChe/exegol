import type { ReactNode } from "react";

/** A toolbar chip's words: hidden inside a narrow terminal toolbar (`toolbar-tight`), where the icon and title stay */
export function ChipLabel({ children }: { children: ReactNode }) {
  return <span className="toolbar-tight:hidden">{children}</span>;
}
