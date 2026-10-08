import { describe, expect, it } from "vitest";
import { mimeFor } from "./mime";

describe("mimeFor", () => {
  it("names the types pages and the viewer use, octet-stream otherwise", () => {
    expect(mimeFor("a/index.HTML")).toBe("text/html; charset=utf-8");
    expect(mimeFor("a.css")).toBe("text/css; charset=utf-8");
    expect(mimeFor("a.mjs")).toBe("text/javascript; charset=utf-8");
    expect(mimeFor("a.svg")).toBe("image/svg+xml");
    expect(mimeFor("a.woff2")).toBe("font/woff2");
    expect(mimeFor("a.png")).toBe("image/png");
    expect(mimeFor("a.pdf")).toBe("application/pdf");
    expect(mimeFor("a.mp4")).toBe("video/mp4");
    expect(mimeFor("a.exe")).toBe("application/octet-stream");
    expect(mimeFor("Makefile")).toBe("application/octet-stream");
  });
});
