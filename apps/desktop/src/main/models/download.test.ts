import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { downloadVerified, type FetchLike, fileSize } from "./download";

const PAYLOAD = Buffer.from("x".repeat(1000) + "y".repeat(1000));
const SHA = createHash("sha256").update(PAYLOAD).digest("hex");

function server(opts: { honorRange?: boolean; body?: Buffer } = {}) {
  const body = opts.body ?? PAYLOAD;
  return vi.fn<FetchLike>(async (_url, init) => {
    const range = init.headers.Range?.match(/^bytes=(\d+)-$/);
    if (range && opts.honorRange !== false) {
      const start = Number(range[1]);
      if (start >= body.length) return new Response(null, { status: 416 });
      return new Response(new Uint8Array(body.subarray(start)), { status: 206 });
    }
    return new Response(new Uint8Array(body), { status: 200 });
  });
}

const SOURCE = "https://example.test/model.tar.bz2";
const tmp = () => join(mkdtempSync(join(tmpdir(), "exegol-dl-")), "model.tar.bz2");

describe("downloadVerified", () => {
  it("downloads and verifies a fresh file", async () => {
    const dest = tmp();
    const fetchImpl = server();
    await downloadVerified({
      url: SOURCE,
      dest,
      expectedBytes: PAYLOAD.length,
      sha256: SHA,
      fetchImpl,
    });
    expect(readFileSync(dest)).toEqual(PAYLOAD);
    expect(fetchImpl.mock.calls[0]?.[1].headers.Range).toBeUndefined();
  });

  it("resumes a partial file with a Range request", async () => {
    const dest = tmp();
    writeFileSync(dest, PAYLOAD.subarray(0, 700));
    const fetchImpl = server();
    const progress: number[] = [];
    await downloadVerified({
      url: SOURCE,
      dest,
      expectedBytes: PAYLOAD.length,
      sha256: SHA,
      fetchImpl,
      onProgress: (received) => progress.push(received),
    });
    expect(fetchImpl.mock.calls[0]?.[1].headers.Range).toBe("bytes=700-");
    expect(progress.at(-1)).toBe(PAYLOAD.length);
    expect(readFileSync(dest)).toEqual(PAYLOAD);
  });

  it("starts over when the server ignores the range", async () => {
    const dest = tmp();
    writeFileSync(dest, PAYLOAD.subarray(0, 700));
    await downloadVerified({
      url: SOURCE,
      dest,
      expectedBytes: PAYLOAD.length,
      sha256: SHA,
      fetchImpl: server({ honorRange: false }),
    });
    expect(readFileSync(dest)).toEqual(PAYLOAD);
  });

  it("skips the request when the file is already complete, and still verifies it", async () => {
    const dest = tmp();
    writeFileSync(dest, PAYLOAD);
    const fetchImpl = server();
    await downloadVerified({
      url: SOURCE,
      dest,
      expectedBytes: PAYLOAD.length,
      sha256: SHA,
      fetchImpl,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("deletes a file whose hash does not match, so it is never resumed", async () => {
    const dest = tmp();
    const tampered = Buffer.from(PAYLOAD);
    tampered[5] = 0x7a;
    await expect(
      downloadVerified({
        url: SOURCE,
        dest,
        expectedBytes: PAYLOAD.length,
        sha256: SHA,
        fetchImpl: server({ body: tampered }),
      }),
    ).rejects.toThrow(/sha256/);
    expect(await fileSize(dest)).toBe(0);
  });

  it("keeps a short download for a later resume", async () => {
    const dest = tmp();
    await expect(
      downloadVerified({
        url: SOURCE,
        dest,
        expectedBytes: PAYLOAD.length,
        sha256: SHA,
        fetchImpl: server({ body: PAYLOAD.subarray(0, 500) }),
      }),
    ).rejects.toThrow(/closed/);
    expect(await fileSize(dest)).toBe(500);
  });

  it("fails on an HTTP error without touching the partial file", async () => {
    const dest = tmp();
    writeFileSync(dest, PAYLOAD.subarray(0, 300));
    const fetchImpl = vi.fn<FetchLike>(async () => new Response("nope", { status: 503 }));
    await expect(
      downloadVerified({
        url: SOURCE,
        dest,
        expectedBytes: PAYLOAD.length,
        sha256: SHA,
        fetchImpl,
      }),
    ).rejects.toThrow(/503/);
    expect(await fileSize(dest)).toBe(300);
  });

  it("stops and deletes the file once the server sends more than expected", async () => {
    const dest = tmp();
    const big = Buffer.concat([PAYLOAD, Buffer.from("extra")]);
    await expect(
      downloadVerified({
        url: SOURCE,
        dest,
        expectedBytes: PAYLOAD.length,
        sha256: SHA,
        fetchImpl: server({ body: big }),
      }),
    ).rejects.toThrow(/more than/);
    expect(await fileSize(dest)).toBe(0);
  });

  it("refuses a redirect to plain http", async () => {
    const dest = tmp();
    const fetchImpl = vi.fn<FetchLike>(async () => {
      const res = new Response(new Uint8Array(PAYLOAD), { status: 200 });
      Object.defineProperty(res, "url", { value: "http://mirror.test/model.tar.bz2" });
      return res;
    });
    await expect(
      downloadVerified({
        url: SOURCE,
        dest,
        expectedBytes: PAYLOAD.length,
        sha256: SHA,
        fetchImpl,
      }),
    ).rejects.toThrow(/https/);
    expect(await fileSize(dest)).toBe(0);
  });
});
