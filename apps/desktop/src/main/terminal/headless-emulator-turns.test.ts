import { describe, expect, it } from "vitest";
import { HeadlessEmulator } from "./headless-emulator";

const rows = (from: number, to: number) => {
  let text = "";
  for (let i = from; i < to; i++) text += `row ${i}\r\n`;
  return text;
};

const cutTexts = (e: HeadlessEmulator) => {
  const { lines, total, turnLines } = e.textLines(1000);
  const first = total - lines.length;
  return turnLines.map((line) => lines[line - first]);
};

describe("HeadlessEmulator turn marks", () => {
  it("keeps a cut on its row once the scrollback is full, until the row itself is gone", async () => {
    const e = new HeadlessEmulator(20, 4, 10);
    await e.writeParsed(rows(0, 20));
    e.markTurn();
    await e.writeParsed(`answer\r\n${rows(21, 26)}`);

    expect(e.textLines(1000).total).toBe(14);
    expect(cutTexts(e)).toEqual(["answer"]);

    await e.writeParsed(rows(26, 50));
    expect(cutTexts(e)).toEqual([]);
    e.dispose();
  });

  it("places no cut on the alt screen, and a clear drops them", async () => {
    const e = new HeadlessEmulator(20, 4, 10);
    await e.writeParsed("\x1b[?1049h");
    e.markTurn();
    expect(e.textLines(10).turnLines).toEqual([]);

    await e.writeParsed("\x1b[?1049l");
    e.markTurn();
    expect(e.textLines(10).turnLines).toHaveLength(1);
    e.clear();
    expect(e.textLines(10).turnLines).toEqual([]);
    e.dispose();
  });
});
