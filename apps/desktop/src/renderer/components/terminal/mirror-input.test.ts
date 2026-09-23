import { describe, expect, it } from "vitest";
import { stripTerminalReports } from "./mirror-input";

describe("stripTerminalReports", () => {
  it("keeps what a keyboard or a paste produces", () => {
    for (const typed of [
      "hello",
      "\r",
      "\x03", // Ctrl+C
      "\x1b", // Esc
      "\x1b[A\x1b[B\x1b[C\x1b[D", // arrows
      "\x1bOA", // application-mode arrow
      "\x1b[15~", // F5
      "\x1b[200~pasted\x1b[201~", // bracketed paste
      "\x1b[<0;10;5M", // SGR mouse click
    ]) {
      expect(stripTerminalReports(typed)).toBe(typed);
    }
  });

  it("drops the replies xterm emits on its own", () => {
    expect(stripTerminalReports("\x1b[12;40R")).toBe("");
    expect(stripTerminalReports("\x1b[?1;2c")).toBe("");
    expect(stripTerminalReports("\x1b[>0;276;0c")).toBe("");
    expect(stripTerminalReports("\x1b[0n")).toBe("");
    expect(stripTerminalReports("\x1b[?2004;1$y")).toBe("");
    expect(stripTerminalReports("\x1b]11;rgb:0a0a/0a0a/0b0b\x07")).toBe("");
    expect(stripTerminalReports("\x1b]10;rgb:e4e4/e4e4/e7e7\x1b\\")).toBe("");
    expect(stripTerminalReports("\x1bP1$r0m\x1b\\")).toBe("");
    expect(stripTerminalReports("\x1b[I\x1b[O")).toBe("");
  });

  it("keeps typed text around a reply in the same chunk", () => {
    expect(stripTerminalReports("y\x1b[3;1R\r")).toBe("y\r");
  });
});
