import { cn, tooltipSurfaceClass } from "@exegol/ui";
import { useLayoutEffect, useRef, useState } from "react";
import { useMountEffect } from "../../hooks/use-mount-effect";

const SHOW_DELAY_MS = 400;
/** Moving from one tooltip to the next within this window shows it at once */
const WARM_MS = 300;
const GAP = 6;

interface Tip {
  text: string;
  rect: DOMRect;
}

/**
 * The app's tooltip for every `title` attribute across the UI: the native
 * macOS tooltip was slow, unstyled and off-theme. On hover the title is lifted
 * off the element (so the native one never shows) and put back on leave, which
 * keeps React's view of the DOM intact. Mounted once per window.
 */
export function TitleTooltips() {
  const [tip, setTip] = useState<Tip | null>(null);

  useMountEffect(() => {
    let target: HTMLElement | null = null;
    let lifted = "";
    let timer: ReturnType<typeof setTimeout> | undefined;
    let warmUntil = 0;

    const release = () => {
      clearTimeout(timer);
      // Put the title back unless React set a new one meanwhile
      if (target && !target.hasAttribute("title")) target.setAttribute("title", lifted);
      if (target) warmUntil = Date.now() + WARM_MS;
      target = null;
      setTip(null);
    };

    const onOver = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest?.<HTMLElement>("[title]");
      if (!el || el === target) return;
      const text = el.getAttribute("title") ?? "";
      release();
      if (!text.trim()) return;
      target = el;
      lifted = text;
      el.removeAttribute("title");
      if (!el.hasAttribute("aria-label") && !el.textContent?.trim()) {
        el.setAttribute("aria-label", text);
      }
      const show = () => {
        if (target === el && el.isConnected) setTip({ text, rect: el.getBoundingClientRect() });
      };
      if (Date.now() < warmUntil) show();
      else timer = setTimeout(show, SHOW_DELAY_MS);
    };

    const onOut = (e: MouseEvent) => {
      if (target && !target.contains(e.relatedTarget as Node | null)) release();
    };

    document.addEventListener("mouseover", onOver, true);
    document.addEventListener("mouseout", onOut, true);
    document.addEventListener("mousedown", release, true);
    document.addEventListener("keydown", release, true);
    window.addEventListener("scroll", release, true);
    window.addEventListener("blur", release);
    return () => {
      release();
      document.removeEventListener("mouseover", onOver, true);
      document.removeEventListener("mouseout", onOut, true);
      document.removeEventListener("mousedown", release, true);
      document.removeEventListener("keydown", release, true);
      window.removeEventListener("scroll", release, true);
      window.removeEventListener("blur", release);
    };
  });

  return tip ? <TipBubble tip={tip} /> : null;
}

/** Below the element, flipped above near the bottom edge, kept inside the window */
function TipBubble({ tip }: { tip: Tip }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const { rect } = tip;
    const below = rect.bottom + GAP;
    const top =
      below + box.height > window.innerHeight - 4
        ? Math.max(4, rect.top - GAP - box.height)
        : below;
    const centered = rect.left + rect.width / 2 - box.width / 2;
    const left = Math.min(Math.max(4, centered), window.innerWidth - box.width - 4);
    setPos({ left, top });
  }, [tip]);

  return (
    <div
      ref={ref}
      role="tooltip"
      className={cn(
        tooltipSurfaceClass,
        "pointer-events-none fixed z-[1000] whitespace-pre-line break-words px-2 py-1 text-[11px]",
      )}
      style={pos ?? { left: 0, top: 0, visibility: "hidden" }}
    >
      {tip.text}
    </div>
  );
}
