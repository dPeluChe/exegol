/** Rejects with `onTimeout()` (or "<what> timed out") once `ms` pass; the timer never outlives `p` */
export function withTimeout<T>(
  p: Promise<T>,
  ms: number,
  onTimeout: string | (() => Error),
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(typeof onTimeout === "string" ? new Error(`${onTimeout} timed out`) : onTimeout()),
      ms,
    );
  });
  return Promise.race([p, expired]).finally(() => clearTimeout(timer));
}
