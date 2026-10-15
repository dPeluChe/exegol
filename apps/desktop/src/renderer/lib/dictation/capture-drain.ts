/** The worklet's answer to "flush": the samples it still held, posted after every earlier chunk */
export interface FlushReply {
  flushed: Float32Array;
}

export type WorkletMessage = Float32Array | FlushReply;

/** Past this the stop goes on with what arrived: the audio graph may have stalled */
export const DRAIN_TIMEOUT_MS = 500;

/** Receives the worklet's chunks. `drain` resolves once the flush reply arrived: the port keeps
 *  order, so every chunk captured before the stop has reached `onChunk` by then */
export function captureReceiver(
  onChunk: (samples: Float32Array) => void,
  timeoutMs = DRAIN_TIMEOUT_MS,
) {
  let waiters: (() => void)[] = [];
  const settle = () => {
    for (const done of waiters.splice(0)) done();
  };
  return {
    receive(data: WorkletMessage): void {
      if (data instanceof Float32Array) {
        if (data.length > 0) onChunk(data);
        return;
      }
      if (data.flushed.length > 0) onChunk(data.flushed);
      settle();
    },
    drain(requestFlush: () => void): Promise<void> {
      return new Promise((resolve) => {
        const done = () => {
          clearTimeout(timer);
          waiters = waiters.filter((w) => w !== done);
          resolve();
        };
        const timer = setTimeout(done, timeoutMs);
        waiters.push(done);
        requestFlush();
      });
    },
    /** The capture closed: nothing more will arrive */
    settle,
  };
}
