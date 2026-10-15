import { describe, expect, it } from "vitest";
import { excludeLineFor } from "./git-exclude";

describe("excludeLineFor", () => {
  it("anchors the path under the prefix and skips a line already there", () => {
    expect(excludeLineFor("", "", ".agents/mcp_config.json")).toBe("/.agents/mcp_config.json");
    expect(excludeLineFor("# x\n", "apps/web/", ".mcp.json")).toBe("/apps/web/.mcp.json");
    expect(excludeLineFor("# x\n/.mcp.json\n", "", ".mcp.json")).toBeNull();
    expect(excludeLineFor("/.mcp.json\r\n", "", ".mcp.json")).toBeNull();
    expect(excludeLineFor("", "[a]*/", ".mcp.json")).toBe("/\\[a]\\*/.mcp.json");
  });
});
