import { describe, expect, it, vi } from "vitest";
import {
  ExegolError,
  isPermanent,
  isTransient,
  PermanentError,
  TimeoutError,
  TransientError,
  withRetry,
} from "./errors";

// ─── Error Hierarchy ───────────────────────────────────────────────────────

describe("Error hierarchy", () => {
  it("ExegolError extends Error", () => {
    const err = new ExegolError("test", "TEST_CODE");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ExegolError);
    expect(err.message).toBe("test");
    expect(err.code).toBe("TEST_CODE");
    expect(err.name).toBe("ExegolError");
  });

  it("TransientError extends ExegolError", () => {
    const err = new TransientError("network down");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ExegolError);
    expect(err).toBeInstanceOf(TransientError);
    expect(err.code).toBe("TRANSIENT");
    expect(err.name).toBe("TransientError");
  });

  it("PermanentError extends ExegolError", () => {
    const err = new PermanentError("invalid config");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ExegolError);
    expect(err).toBeInstanceOf(PermanentError);
    expect(err.code).toBe("PERMANENT");
    expect(err.name).toBe("PermanentError");
  });

  it("TimeoutError extends TransientError", () => {
    const err = new TimeoutError("request timed out");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ExegolError);
    expect(err).toBeInstanceOf(TransientError);
    expect(err).toBeInstanceOf(TimeoutError);
    expect(err.code).toBe("TIMEOUT");
    expect(err.name).toBe("TimeoutError");
  });

  it("PermanentError is not a TransientError", () => {
    const err = new PermanentError("fatal");
    expect(err).not.toBeInstanceOf(TransientError);
  });

  it("TransientError is not a PermanentError", () => {
    const err = new TransientError("retry me");
    expect(err).not.toBeInstanceOf(PermanentError);
  });

  it("preserves cause through the hierarchy", () => {
    const original = new TypeError("connection reset");
    const transient = new TransientError("fetch failed", "NET", original);
    expect(transient.cause).toBe(original);

    const timeout = new TimeoutError("30s exceeded", original);
    expect(timeout.cause).toBe(original);

    const permanent = new PermanentError("bad config", "CFG", original);
    expect(permanent.cause).toBe(original);
  });

  it("cause is undefined when not provided", () => {
    const err = new ExegolError("test", "X");
    expect(err.cause).toBeUndefined();
  });
});

// ─── Type Guards ───────────────────────────────────────────────────────────

describe("isTransient / isPermanent helpers", () => {
  it("isTransient returns true for TransientError", () => {
    expect(isTransient(new TransientError("net"))).toBe(true);
  });

  it("isTransient returns true for TimeoutError", () => {
    expect(isTransient(new TimeoutError("timeout"))).toBe(true);
  });

  it("isTransient returns false for PermanentError", () => {
    expect(isTransient(new PermanentError("perm"))).toBe(false);
  });

  it("isTransient returns false for plain Error", () => {
    expect(isTransient(new Error("plain"))).toBe(false);
  });

  it("isTransient returns false for non-errors", () => {
    expect(isTransient("string")).toBe(false);
    expect(isTransient(null)).toBe(false);
    expect(isTransient(undefined)).toBe(false);
  });

  it("isPermanent returns true for PermanentError", () => {
    expect(isPermanent(new PermanentError("perm"))).toBe(true);
  });

  it("isPermanent returns false for TransientError", () => {
    expect(isPermanent(new TransientError("net"))).toBe(false);
  });

  it("isPermanent returns false for plain Error", () => {
    expect(isPermanent(new Error("plain"))).toBe(false);
  });
});

// ─── withRetry ─────────────────────────────────────────────────────────────

describe("withRetry", () => {
  it("succeeds on first try", async () => {
    const result = await withRetry(() => Promise.resolve(42), {
      maxRetries: 3,
      baseDelayMs: 1,
    });
    expect(result).toBe(42);
  });

  it("retries on TransientError and eventually succeeds", async () => {
    let attempts = 0;
    const result = await withRetry(
      () => {
        attempts++;
        if (attempts < 3) throw new TransientError("not yet");
        return Promise.resolve("ok");
      },
      { maxRetries: 3, baseDelayMs: 1 },
    );
    expect(result).toBe("ok");
    expect(attempts).toBe(3);
  });

  it("gives up after maxRetries on TransientError", async () => {
    let attempts = 0;
    await expect(
      withRetry(
        () => {
          attempts++;
          throw new TransientError("always fails");
        },
        { maxRetries: 2, baseDelayMs: 1 },
      ),
    ).rejects.toThrow("always fails");
    // 1 initial + 2 retries = 3 attempts
    expect(attempts).toBe(3);
  });

  it("immediately throws PermanentError without retrying", async () => {
    let attempts = 0;
    await expect(
      withRetry(
        () => {
          attempts++;
          throw new PermanentError("fatal");
        },
        { maxRetries: 3, baseDelayMs: 1 },
      ),
    ).rejects.toThrow("fatal");
    expect(attempts).toBe(1);
  });

  it("immediately throws plain Error without retrying", async () => {
    let attempts = 0;
    await expect(
      withRetry(
        () => {
          attempts++;
          throw new Error("unknown");
        },
        { maxRetries: 3, baseDelayMs: 1 },
      ),
    ).rejects.toThrow("unknown");
    expect(attempts).toBe(1);
  });

  it("retries TimeoutError (subclass of TransientError)", async () => {
    let attempts = 0;
    const result = await withRetry(
      () => {
        attempts++;
        if (attempts < 2) throw new TimeoutError("timed out");
        return Promise.resolve("recovered");
      },
      { maxRetries: 3, baseDelayMs: 1 },
    );
    expect(result).toBe("recovered");
    expect(attempts).toBe(2);
  });

  it("uses exponential backoff delays", async () => {
    vi.useFakeTimers();
    let attempts = 0;
    const promise = withRetry(
      () => {
        attempts++;
        if (attempts <= 3) throw new TransientError("fail");
        return Promise.resolve("done");
      },
      { maxRetries: 3, baseDelayMs: 100 },
    );

    // First attempt fails immediately, schedules 100ms delay
    await vi.advanceTimersByTimeAsync(100);
    // Second attempt fails, schedules 200ms delay
    await vi.advanceTimersByTimeAsync(200);
    // Third attempt fails, schedules 400ms delay
    await vi.advanceTimersByTimeAsync(400);

    const result = await promise;
    expect(result).toBe("done");
    expect(attempts).toBe(4);
    vi.useRealTimers();
  });
});
