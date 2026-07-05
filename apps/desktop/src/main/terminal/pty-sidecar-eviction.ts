// Ring buffer eviction policy for the PTY sidecar (T143).
// Global cap on pre-allocated ring buffer memory across all sessions. When
// over budget, the least-recently-active idle sessions get their buffer
// content flushed to disk and freed; content is transparently reloaded on
// their next write. Keeps a demo with many idle agents from ballooning
// memory (8MB × N sessions, pre-allocated eagerly by RingBuffer).

import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  EXEGOL_DIR,
  GLOBAL_RING_BUFFER_CAP_BYTES,
  RING_BUFFER_EVICTION_IDLE_MS,
  type SessionMemoryInfo,
} from "./pty-sidecar-protocol";
import type { RingBuffer } from "./ring-buffer";

export interface EvictableSession {
  id: string;
  ringBuffer: RingBuffer;
  pendingBytes: number;
  lastActivityAt: number;
  evictedPath: string | null;
}

const RING_EVICT_DIR = join(EXEGOL_DIR, "ring-evicted");

function evictedPathFor(id: string): string {
  return join(RING_EVICT_DIR, `${id}.bin`);
}

/** Synchronously reload an evicted session's buffer before it's written to or read. */
export function reloadIfEvicted(s: EvictableSession): void {
  if (!s.evictedPath) return;
  // release() dropped the backing allocation — regrow before writing, or the
  // reloaded snapshot (and every subsequent PTY byte) is silently discarded.
  s.ringBuffer.ensureCapacity();
  try {
    const data = readFileSync(s.evictedPath);
    s.ringBuffer.write(data);
  } catch {
    // File missing/unreadable — buffer just starts empty again, non-fatal.
  } finally {
    try {
      unlinkSync(s.evictedPath);
    } catch {
      /* already gone */
    }
    s.evictedPath = null;
  }
}

function evictToDisk(s: EvictableSession): void {
  if (s.evictedPath) return; // already evicted
  try {
    mkdirSync(RING_EVICT_DIR, { recursive: true });
    writeFileSync(evictedPathFor(s.id), s.ringBuffer.snapshot());
    // release(), not clear(): clear only resets pointers and keeps the 8MB
    // allocation resident — eviction would free zero actual memory.
    s.ringBuffer.release();
    s.evictedPath = evictedPathFor(s.id);
  } catch {
    // Disk write failed — leave the buffer resident, try again next sweep.
  }
}

/** Sweep all sessions and evict LRU-idle ones to disk if over the global cap. */
export function evictIfOverCap(sessions: Iterable<EvictableSession>): void {
  const all = Array.from(sessions);
  let total = 0;
  for (const s of all) {
    if (!s.evictedPath) total += s.ringBuffer.capacity;
  }
  if (total <= GLOBAL_RING_BUFFER_CAP_BYTES) return;

  const now = Date.now();
  const idleCandidates = all
    .filter((s) => !s.evictedPath && now - s.lastActivityAt >= RING_BUFFER_EVICTION_IDLE_MS)
    .sort((a, b) => a.lastActivityAt - b.lastActivityAt); // oldest activity first (LRU)

  for (const s of idleCandidates) {
    if (total <= GLOBAL_RING_BUFFER_CAP_BYTES) break;
    const freed = s.ringBuffer.capacity;
    evictToDisk(s);
    if (s.evictedPath) total -= freed;
  }
}

/** Per-session memory report for the `session.memory` RPC (Monitor > Resources). */
export function computeMemoryInfo(sessions: Iterable<EvictableSession>): {
  sessions: SessionMemoryInfo[];
  totalCapacityBytes: number;
} {
  const memInfo: SessionMemoryInfo[] = Array.from(sessions).map((s) => ({
    id: s.id,
    capacityBytes: s.evictedPath ? 0 : s.ringBuffer.capacity,
    pendingBytes: s.pendingBytes,
    evicted: s.evictedPath !== null,
  }));
  const totalCapacityBytes = memInfo.reduce((sum, m) => sum + m.capacityBytes, 0);
  return { sessions: memInfo, totalCapacityBytes };
}
