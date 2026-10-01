import { describe, expect, it } from "vitest";
import { DA1_REPLY, da1Replies, stripTerminalQueries } from "./pty-sidecar-queries";

describe("da1Replies (T184.2)", () => {
  it("answers ESC[c and ESC[0c, once per query", () => {
    expect(da1Replies("\x1b[c")).toBe(DA1_REPLY);
    expect(da1Replies("prompt\x1b[0c$ \x1b[c")).toBe(DA1_REPLY + DA1_REPLY);
  });

  it("leaves DA2, RIS and plain output alone", () => {
    expect(da1Replies("\x1b[>c\x1bc\x1b[31mred\x1b[0m")).toBe("");
    expect(da1Replies("no escapes")).toBe("");
  });
});

describe("stripTerminalQueries (T184.3)", () => {
  it("removes DSR, DA, mode and colour queries", () => {
    const queries = [
      "\x1b[6n",
      "\x1b[5n",
      "\x1b[?6n",
      "\x1b[c",
      "\x1b[0c",
      "\x1b[>c",
      "\x1b[>0c",
      "\x1b[?2031$p",
      "\x1b[4$p",
      "\x1b]10;?\x07",
      "\x1b]11;?\x1b\\",
      "\x1b]12;?\x07",
    ];
    expect(stripTerminalQueries(`a${queries.join("b")}c`)).toBe(
      `a${"b".repeat(queries.length - 1)}c`,
    );
  });

  it("keeps everything that is not a question", () => {
    const output = "\x1b[31mred\x1b[0m\x1b[?1049h\x1b]11;rgb:0000/0000/0000\x07\x1b[2J\x1bc done";
    expect(stripTerminalQueries(output)).toBe(output);
  });
});
