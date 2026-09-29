import { useLayoutEffect, useRef } from "react";

/** A ref that always holds the last committed value, for callbacks built once
 *  (xterm, Monaco, IPC listeners). Written after commit, never during render. */
export function useLatest<T>(value: T) {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}
