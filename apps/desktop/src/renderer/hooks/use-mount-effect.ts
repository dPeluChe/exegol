import { type EffectCallback, useEffect } from "react";

/**
 * Explicit mount effect — runs once on mount, cleanup on unmount.
 * Named to make intent clear and prevent ad-hoc useEffect usage.
 * See: https://react.dev/learn/you-might-not-need-an-effect
 */
export function useMountEffect(callback: EffectCallback) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional mount-only effect
  useEffect(callback, []);
}
