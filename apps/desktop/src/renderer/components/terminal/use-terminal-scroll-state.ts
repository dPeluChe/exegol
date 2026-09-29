import { useCallback, useState } from "react";

/** Scroll position of the terminal, for the floating scroll buttons */
export function useTerminalScrollState() {
  const [scrollAtTop, setScrollAtTop] = useState(true);
  const [scrollAtBottom, setScrollAtBottom] = useState(true);
  const [hasNewOutput, setHasNewOutput] = useState(false);

  const handleScrollPosition = useCallback((atTop: boolean, atBottom: boolean, wrote?: boolean) => {
    setScrollAtTop(atTop);
    setScrollAtBottom(atBottom);
    // T155: pulse the scroll-to-bottom button when output lands off-screen
    if (atBottom) setHasNewOutput(false);
    else if (wrote) setHasNewOutput(true);
  }, []);

  return { scrollAtTop, scrollAtBottom, hasNewOutput, handleScrollPosition };
}
