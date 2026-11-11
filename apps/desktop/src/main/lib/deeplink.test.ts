import { describe, expect, it } from "vitest";
import { findDeepLinkArg, parseCaptureLink, parseDeepLink } from "./deeplink";

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

  it("reads a Linux cold-start argv (packaged binary, Chromium switches)", () => {
    const argv = ["/opt/Exegol/exegol", "--no-sandbox", "exegol://open?path=%2Fhome%2Fa%2Fp"];
    expect(parseDeepLink(findDeepLinkArg(argv) ?? "")).toEqual({ path: "/home/a/p" });
  });

  it("returns null when absent", () => {
    expect(findDeepLinkArg(["/usr/bin/app", "--flag"])).toBeNull();
  });
});

describe("parseCaptureLink", () => {
  it("takes an http(s) url, a title and text, fully encoded as the CLI sends them", () => {
    expect(
      parseCaptureLink("exegol://capture?url=%68ttps%3A%2F%2Fa.dev%2Fx&title=Hi&text=read%20this"),
    ).toEqual({ url: "https://a.dev/x", title: "Hi", text: "read this" });
  });

  it("drops a url that is not http(s), and needs a url or text", () => {
    expect(parseCaptureLink("exegol://capture?url=file%3A%2F%2F%2Fetc&text=t")).toEqual({
      url: null,
      title: null,
      text: "t",
    });
    expect(parseCaptureLink("exegol://capture?url=javascript%3Ax")).toBeNull();
    expect(parseCaptureLink("exegol://open?path=/tmp")).toBeNull();
  });

  it("takes one bare link sent as text as the url, and leaves a sentence as text", () => {
    expect(parseCaptureLink("exegol://capture?text=https%3A%2F%2Fa.dev%2Fx%3Fq%3D1")).toEqual({
      url: "https://a.dev/x?q=1",
      title: null,
      text: null,
    });
    expect(parseCaptureLink("exegol://capture?text=see%20https%3A%2F%2Fa.dev")?.url).toBeNull();
  });
});
