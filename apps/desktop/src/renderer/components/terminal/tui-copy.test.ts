import { describe, expect, it } from "vitest";
import { parseOsc52 } from "./tui-copy";

const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));

describe("parseOsc52", () => {
  it("decodes the copied text, UTF-8 included", () => {
    expect(parseOsc52(`c;${b64("hola ñandú\nline 2")}`)).toBe("hola ñandú\nline 2");
    expect(parseOsc52(`;${b64("x")}`)).toBe("x");
  });

  it("ignores a query, an empty payload and bad data", () => {
    expect(parseOsc52("c;?")).toBeNull();
    expect(parseOsc52("c;")).toBeNull();
    expect(parseOsc52("c")).toBeNull();
    expect(parseOsc52("c;***")).toBeNull();
    expect(parseOsc52(`c;${btoa("\xff\xfe")}`)).toBeNull();
  });
});
