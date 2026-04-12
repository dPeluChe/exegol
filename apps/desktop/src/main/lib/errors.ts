/**
 * Structured Error Classification (T80)
 *
 * Distinguishes transient (retryable) from permanent (fatal) errors.
 * Provides a retry helper that only retries on TransientError.
 */

import { logger } from "./logger";

// ─── Error Hierarchy ───────────────────────────────────────────────────────

/** Base error class for all Exegol errors. Adds a machine-readable `code` and preserves `cause`. */
export class ExegolError extends Error {
  readonly code: string;

  constructor(message: string, code: string, cause?: unknown) {
    super(message, { cause });
    this.name = "ExegolError";
    this.code = code;
  }
}

/** Transient (retryable) errors — network hiccups, timeouts, rate limits. */
export class TransientError extends ExegolError {
  constructor(message: string, code = "TRANSIENT", cause?: unknown) {
    super(message, code, cause);
    this.name = "TransientError";
  }
}

/** Permanent (fatal) errors — invalid config, missing resources, auth failures. */
export class PermanentError extends ExegolError {
  constructor(message: string, code = "PERMANENT", cause?: unknown) {
    super(message, code, cause);
    this.name = "PermanentError";
  }
}

/** Timeout errors — a specific kind of transient failure. */
export class TimeoutError extends TransientError {
  constructor(message: string, cause?: unknown) {
    super(message, "TIMEOUT", cause);
    this.name = "TimeoutError";
  }
}

// ─── Type Guards ───────────────────────────────────────────────────────────

export function isTransient(err: unknown): boolean {
  return err instanceof TransientError;
}

export function isPermanent(err: unknown): boolean {
  return err instanceof PermanentError;
}

// ─── Retry Helper ──────────────────────────────────────────────────────────

export interface RetryOptions {
  /** Maximum number of retries (default: 3) */
  maxRetries?: number;
  /** Base delay in ms for exponential backoff (default: 1000) */
  baseDelayMs?: number;
  /** Label for log messages */
  label?: string;
}

/**
 * Retry a function on TransientError with exponential backoff.
 * Immediately rethrows PermanentError or non-Exegol errors.
 */
export async function withRetry<T>(fn: () => Promise<T>, opts?: RetryOptions): Promise<T> {
  const maxRetries = opts?.maxRetries ?? 3;
  const baseDelayMs = opts?.baseDelayMs ?? 1000;
  const label = opts?.label ?? "withRetry";

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      // Non-transient errors are immediately fatal
      if (!isTransient(err)) {
        throw err;
      }

      // Exhausted retries
      if (attempt >= maxRetries) {
        break;
      }

      const delay = baseDelayMs * 2 ** attempt;
      logger.warn(
        `[${label}] Attempt ${attempt + 1}/${maxRetries + 1} failed (retrying in ${delay}ms):`,
        err instanceof Error ? err.message : err,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
