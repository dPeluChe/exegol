import { describe, expect, it } from "vitest";
import { remoteWebUrl } from "./remote-web-url";

describe("remoteWebUrl", () => {
  it.each([
    ["git@github.com:dPeluChe/exegol.git", "https://github.com/dPeluChe/exegol"],
    ["https://github.com/dPeluChe/exegol.git", "https://github.com/dPeluChe/exegol"],
    ["https://github.com/dPeluChe/exegol", "https://github.com/dPeluChe/exegol"],
    ["https://user:ghp_secret@gitlab.com/group/sub/repo.git", "https://gitlab.com/group/sub/repo"],
    ["ssh://git@bitbucket.org:22/team/repo.git", "https://bitbucket.org/team/repo"],
  ])("%s", (remote, web) => {
    expect(remoteWebUrl(remote)).toBe(web);
  });

  it("returns null for a local path remote", () => {
    expect(remoteWebUrl("/Users/me/repos/origin.git")).toBeNull();
    expect(remoteWebUrl("file:///tmp/x.git")).toBeNull();
  });
});
