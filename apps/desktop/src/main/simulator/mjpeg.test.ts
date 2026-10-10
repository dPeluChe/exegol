import { describe, expect, it } from "vitest";
import { contentLength, MjpegParser } from "./mjpeg";

const HEAD =
  "HTTP/1.1 200 OK\r\nContent-Type: multipart/x-mixed-replace; boundary=--mjpegstream\r\n\r\n";

function jpeg(seed: number, size: number): Buffer {
  const body = Buffer.alloc(size, seed);
  body[0] = 0xff;
  body[1] = 0xd8;
  body[size - 2] = 0xff;
  body[size - 1] = 0xd9;
  return body;
}

function part(frame: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from(
      `--mjpegstream\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`,
    ),
    frame,
    Buffer.from("\r\n"),
  ]);
}

function collect() {
  const frames: Buffer[] = [];
  return { frames, parser: new MjpegParser((f) => frames.push(f)) };
}

describe("MjpegParser", () => {
  const a = jpeg(1, 300);
  const b = jpeg(2, 5_000);
  const stream = Buffer.concat([Buffer.from(HEAD), part(a), part(b)]);

  it("reads AXe's stream in one chunk", () => {
    const { frames, parser } = collect();
    parser.push(stream);
    expect(frames).toEqual([a, b]);
  });

  it("reads it split at every byte, headers and boundaries included", () => {
    const { frames, parser } = collect();
    for (let i = 0; i < stream.length; i++) parser.push(stream.subarray(i, i + 1));
    expect(frames).toEqual([a, b]);
  });

  it("reads it in uneven chunks that cut the boundary line", () => {
    const { frames, parser } = collect();
    const cut = HEAD.length + part(a).length + 5;
    parser.push(stream.subarray(0, 40));
    parser.push(stream.subarray(40, cut));
    parser.push(stream.subarray(cut));
    expect(frames).toEqual([a, b]);
  });

  it("holds a frame until all its bytes arrive", () => {
    const { frames, parser } = collect();
    parser.push(stream.subarray(0, stream.length - 10));
    expect(frames).toEqual([a]);
    parser.push(stream.subarray(stream.length - 10));
    expect(frames).toEqual([a, b]);
  });

  it("drops a body that is not a JPEG and keeps going", () => {
    const { frames, parser } = collect();
    parser.push(Buffer.concat([part(Buffer.from("not a jpeg")), part(a)]));
    expect(frames).toEqual([a]);
  });

  it("frames do not share memory with the parser's buffer", () => {
    const { frames, parser } = collect();
    const chunk = Buffer.concat([part(a)]);
    parser.push(chunk);
    chunk.fill(0);
    expect(frames[0]).toEqual(a);
  });
});

describe("contentLength", () => {
  it("reads the header in any case, after a boundary line", () => {
    expect(contentLength("\r\n--mjpegstream\r\ncontent-length: 42")).toBe(42);
    expect(contentLength("Content-Type: image/jpeg")).toBeNull();
  });
});
