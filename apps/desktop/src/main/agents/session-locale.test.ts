import { describe, expect, it } from "vitest";
import { hasUtf8Locale, localeFromEnviron, localesFromPs } from "./session-locale";

describe("hasUtf8Locale", () => {
  it("reads LC_ALL over LC_CTYPE over LANG", () => {
    expect(hasUtf8Locale({ LC_CTYPE: "en_US.UTF-8" })).toBe(true);
    expect(hasUtf8Locale({ LANG: "es_MX.utf8" })).toBe(true);
    expect(hasUtf8Locale({ LC_ALL: "C", LANG: "en_US.UTF-8" })).toBe(false);
    expect(hasUtf8Locale({})).toBe(false);
  });
});

describe("localesFromPs", () => {
  it("takes each pid's locale from the environment after the command", () => {
    const out = localesFromPs(
      [
        " 2909 /bin/zsh -il USER=me PATH=/usr/bin EXEGOL_AGENT_ID=a1",
        "10914 /bin/zsh -ic claude USER=me LC_CTYPE=en_US.UTF-8 TERM=xterm-256color",
        "",
      ].join("\n"),
    );
    expect(out.get(2909)).toEqual({});
    expect(out.get(10914)).toEqual({ LC_CTYPE: "en_US.UTF-8" });
  });
});

describe("localeFromEnviron", () => {
  it("splits /proc environ on NUL", () => {
    expect(localeFromEnviron("PATH=/bin\0LANG=C.UTF-8\0LC_ALL=\0")).toEqual({
      LANG: "C.UTF-8",
      LC_ALL: "",
    });
  });
});
