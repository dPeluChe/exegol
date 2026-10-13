import { startWatchFollow } from "../lib/watch-follow";
import { useMountEffect } from "./use-mount-effect";

/** Watching pins follow their session across resumes. Mounted once, in App */
export function useWatchFollow(): void {
  useMountEffect(() => startWatchFollow());
}
