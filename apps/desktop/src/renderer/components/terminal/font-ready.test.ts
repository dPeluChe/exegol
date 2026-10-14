import { afterEach, describe, expect, it, vi } from "vitest";
import { refitWhenFontLoads } from "./font-ready";

function stubFonts(loaded: boolean) {
  let finish: () => void = () => {};
  const load = vi.fn(
    () =>
      new Promise<void>((r) => {
        finish = r;
      }),
  );
  vi.stubGlobal("document", { fonts: { check: () => loaded, load } });
  return { load, finish: () => finish() };
}

function fakeTerminal() {
  const sizes: number[] = [];
  let fontSize = 14;
  const options = {
    fontFamily: '"MesloLGS NF"',
    get fontSize() {
      return fontSize;
    },
    set fontSize(v: number) {
      fontSize = v;
      sizes.push(v);
    },
  };
  return { terminal: { options } as never, sizes };
}

describe("refitWhenFontLoads", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("a font already loaded needs nothing", () => {
    const { load } = stubFonts(true);
    refitWhenFontLoads(fakeTerminal().terminal, vi.fn());
    expect(load).not.toHaveBeenCalled();
  });

  it("remeasures and refits once the font loads, ending at the same font size", async () => {
    const fonts = stubFonts(false);
    const { terminal, sizes } = fakeTerminal();
    const refit = vi.fn();
    refitWhenFontLoads(terminal, refit);
    expect(fonts.load).toHaveBeenCalledWith('14px "MesloLGS NF"');
    expect(refit).not.toHaveBeenCalled();
    fonts.finish();
    await Promise.resolve();
    expect(sizes).toEqual([15, 14]);
    expect(refit).toHaveBeenCalledTimes(1);
  });

  it("an unmounted terminal is left alone", async () => {
    const fonts = stubFonts(false);
    const { terminal, sizes } = fakeTerminal();
    const refit = vi.fn();
    refitWhenFontLoads(terminal, refit)();
    fonts.finish();
    await Promise.resolve();
    expect(sizes).toEqual([]);
    expect(refit).not.toHaveBeenCalled();
  });
});
