import { cn } from "@exegol/ui";
import { useRef } from "react";
import { useMountEffect } from "../../hooks/use-mount-effect";
import { currentAnalyser } from "../../lib/dictation/controller";

const BARS = 28;

/** Mounted only while listening (muted and flat while paused): the draw loop stops with it. Each bar is the level of a slice
 *  of the last audio frame, held and eased down so speech reads as motion */
export function LevelBars({ muted = false }: { muted?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const glow = useRef<HTMLDivElement>(null);
  useMountEffect(() => {
    let frame = 0;
    let glowShown = 0;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const data = new Uint8Array(1024);
    const levels = new Float32Array(BARS);
    let color = "";
    let colorOf = "";
    // Reduced motion: a few still frames a second, no easing or glow
    const next = () => {
      frame = reduce ? window.setTimeout(draw, 200) : requestAnimationFrame(draw);
    };
    const draw = () => {
      next();
      const canvas = ref.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;
      // Paused swaps the class: the bar color follows it
      if (canvas.className !== colorOf) {
        colorOf = canvas.className;
        color = getComputedStyle(canvas).color;
      }
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth * dpr;
      const h = canvas.clientHeight * dpr;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      const analyser = currentAnalyser();
      if (analyser) analyser.getByteTimeDomainData(data);
      const step = Math.floor(data.length / BARS);
      let total = 0;
      for (let i = 0; i < BARS; i++) {
        let sum = 0;
        for (let j = i * step; j < (i + 1) * step; j++) {
          const v = analyser ? ((data[j] ?? 128) - 128) / 128 : 0;
          sum += v * v;
        }
        // Speech RMS sits around 0.02-0.2: scaled so a normal voice fills most of the height
        const level = Math.min(1, Math.sqrt(sum / step) * 6);
        levels[i] = reduce ? level : Math.max(level, (levels[i] ?? 0) * 0.86);
        total += levels[i] ?? 0;
      }
      // Only real moves restyle the blurred layer
      const glowLevel = reduce ? 0 : Math.min(1, (total / BARS) * 2);
      if (glow.current && Math.abs(glowLevel - glowShown) > 0.05) {
        glowShown = glowLevel;
        glow.current.style.opacity = glowLevel.toFixed(2);
      }
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = color;
      const gap = 3 * dpr;
      const barW = (w - gap * (BARS - 1)) / BARS;
      const min = 3 * dpr;
      for (let i = 0; i < BARS; i++) {
        // Taller in the middle: reads as a voice, not a meter
        const shape = 0.55 + 0.45 * Math.sin((Math.PI * (i + 0.5)) / BARS);
        const level = levels[i] ?? 0;
        const barH = Math.max(min, level * shape * h);
        ctx.globalAlpha = 0.35 + 0.65 * Math.min(1, level * 1.5);
        ctx.beginPath();
        ctx.roundRect(i * (barW + gap), (h - barH) / 2, barW, barH, barW / 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };
    next();
    return () => {
      if (reduce) clearTimeout(frame);
      else cancelAnimationFrame(frame);
    };
  });
  return (
    <div className="relative h-10">
      <div
        ref={glow}
        aria-hidden
        className="pointer-events-none absolute inset-x-6 inset-y-1 rounded-full bg-accent/25 opacity-0 blur-xl"
      />
      <canvas
        ref={ref}
        aria-hidden
        className={cn(
          "pointer-events-none relative h-10 w-full",
          muted ? "text-text-muted" : "text-accent",
        )}
      />
    </div>
  );
}
