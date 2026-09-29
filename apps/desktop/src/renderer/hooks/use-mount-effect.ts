import { type EffectCallback, useEffect, useRef } from "react";

/**
 * Explicit mount effect — runs once on mount, cleanup on unmount.
 * Named to make intent clear and prevent ad-hoc useEffect usage.
 * See: https://react.dev/learn/you-might-not-need-an-effect
 */
export function useMountEffect(callback: EffectCallback) {
  // The first render's callback, by design: later renders never re-run it
  const onMount = useRef(callback);
  useEffect(() => onMount.current(), []);
}
