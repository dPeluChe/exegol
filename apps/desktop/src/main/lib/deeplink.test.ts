import { describe, expect, it } from "vitest";
import { findDeepLinkArg, parseDeepLink } from "./deeplink";

describe("parseDeepLink", () => {
  it("parses a plain absolute path", () => {
    expect(parseDeepLink("exegol://open?path=/Users/foo/project")).toEqual({
      path: "/Users/foo/project",
    });
  });

  it("decodes url-encoded segments (spaces)", () => {
    expect(parseDeepLink("exegol://open?path=/Users/foo/my%20project")).toEqual({
      path: "/Users/foo/my project",
    });
  });

  it("decodes fully percent-encoded paths (CLI encodes every byte)", () => {
    expect(parseDeepLink("exegol://open?path=%2FUsers%2Ffoo%2Fbar")).toEqual({
      path: "/Users/foo/bar",
    });
  });

  it("accepts triple-slash form (empty host)", () => {
    expect(parseDeepLink("exegol:///open?path=/tmp/x")).toEqual({ path: "/tmp/x" });
  });

  it("rejects other schemes", () => {
    expect(parseDeepLink("http://open?path=/foo")).toBeNull();
    expect(parseDeepLink("klaudio://open?path=/foo")).toBeNull();
  });

  it("rejects unknown actions", () => {
    expect(parseDeepLink("exegol://close?path=/foo")).toBeNull();
  });

  it("rejects missing or empty path param", () => {
    expect(parseDeepLink("exegol://open")).toBeNull();
    expect(parseDeepLink("exegol://open?path=")).toBeNull();
  });

  it("rejects relative paths", () => {
    expect(parseDeepLink("exegol://open?path=foo/bar")).toBeNull();
    expect(parseDeepLink("exegol://open?path=./foo")).toBeNull();
  });

  it("rejects malformed URLs", () => {
    expect(parseDeepLink("not a url")).toBeNull();
    expect(parseDeepLink("")).toBeNull();
  });
});

describe("findDeepLinkArg", () => {
  it("finds the exegol:// arg in argv", () => {
    expect(findDeepLinkArg(["/usr/bin/app", "--flag", "exegol://open?path=/x"])).toBe(
      "exegol://open?path=/x",
    );
  });

  it("returns null when absent", () => {
    expect(findDeepLinkArg(["/usr/bin/app", "--flag"])).toBeNull();
  });
});
