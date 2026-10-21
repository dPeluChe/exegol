import { type MutableRefObject, type RefObject, useRef } from "react";
import {
  clampToScreen,
  isTap,
  type Rect,
  type Size,
  swipeSeconds,
  toDevicePoint,
} from "../../lib/simulator-geometry";
import { keyInput, type SimInput, textInputs } from "../../lib/simulator-keys";
import { trpcMutate } from "../../lib/trpc-client";
import { toastError } from "../../stores/toasts";

const TYPE_FLUSH_MS = 120;
const TYPE_FLUSH_CHARS = 200;

/** Pointer and keyboard on the live view to AXe taps, swipes, keys and text */
export function useSimulatorInput({
  udid,
  boxRef,
  canvasRef,
  frameSize,
  screenPoints,
}: {
  udid: string;
  boxRef: RefObject<HTMLDivElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  frameSize: MutableRefObject<Size>;
  screenPoints: () => Size | null;
}) {
  // One input at a time, in order: a tap must not land before the text typed ahead of it
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const send = (path: string, input: object) => {
    queue.current = queue.current.then(() =>
      trpcMutate(path, { udid, ...input }).catch(toastError("Simulator input failed")),
    );
  };
  const sendInput = (input: SimInput) =>
    "key" in input ? send("simulator.key", { key: input.key }) : send("simulator.type", input);

  const typed = useRef("");
  const flushTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const flushTyped = () => {
    clearTimeout(flushTimer.current);
    const text = typed.current;
    typed.current = "";
    for (const input of textInputs(text)) sendInput(input);
  };
  const typeText = (text: string) => {
    typed.current += text;
    clearTimeout(flushTimer.current);
    if (typed.current.length >= TYPE_FLUSH_CHARS) flushTyped();
    else flushTimer.current = setTimeout(flushTyped, TYPE_FLUSH_MS);
  };

  const canvasBox = (): Rect | null => {
    const rect = canvasRef.current?.getBoundingClientRect();
    return rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null;
  };

  const press = useRef<{ x: number; y: number; t: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    boxRef.current?.focus();
    press.current = { x: e.clientX, y: e.clientY, t: performance.now() };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const down = press.current;
    press.current = null;
    const box = canvasBox();
    const points = screenPoints();
    const frame = frameSize.current;
    if (!down || !box || !points || !frame.width) return;
    const up = { x: e.clientX, y: e.clientY };
    flushTyped();
    if (isTap(down, up)) {
      const at = toDevicePoint(up, box, frame, points);
      if (at) send("simulator.tap", at);
      return;
    }
    const from = toDevicePoint(down, box, frame, points);
    const to = toDevicePoint(clampToScreen(up, box, frame), box, frame, points);
    if (from && to)
      send("simulator.swipe", { from, to, durationS: swipeSeconds(performance.now() - down.t) });
  };
  const onPointerCancel = () => {
    press.current = null;
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const input = keyInput(e);
    if (!input) return;
    e.preventDefault();
    if ("text" in input) {
      typeText(input.text);
      return;
    }
    flushTyped();
    sendInput(input);
  };
  const onPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const text = e.clipboardData.getData("text");
    if (!textInputs(text).length) return;
    e.preventDefault();
    typeText(text);
  };

  return { onKeyDown, onPaste, onPointerDown, onPointerUp, onPointerCancel };
}
