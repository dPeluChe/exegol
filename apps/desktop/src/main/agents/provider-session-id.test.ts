import { describe, expect, it, vi } from "vitest";

vi.mock("./registry", () => ({
  getProviderRegistry: () => ({
    get: (id: string) =>
      ({
        codex: { capabilities: { resumeCommandPattern: "codex resume " } },
        opencode: { capabilities: { resumeCommandPattern: "opencode -s " } },
      })[id],
  }),
}));

import { providerSessionId } from "./provider-session-id";

// Dedupe between Exegol's rows and the CLIs' own stores hangs on this: get it
// wrong for a provider and every session it launched shows up twice.
describe("providerSessionId", () => {
  it("prefers the captured claude session id", () => {
    expect(providerSessionId("claude-code", "uuid-1", "claude --resume uuid-9")).toBe("uuid-1");
  });

  it("strips the provider's declared resume prefix", () => {
    expect(providerSessionId("codex", null, "codex resume 019f8b75")).toBe("019f8b75");
    expect(providerSessionId("opencode", null, "opencode -s ses_abc")).toBe("ses_abc");
  });

  it("takes the first token when the command carries extra flags", () => {
    expect(providerSessionId("codex", null, "codex resume 019f8b75 --yolo")).toBe("019f8b75");
  });

  it("unquotes an id the CLI printed quoted", () => {
    expect(providerSessionId("codex", null, `codex resume "019f8b75"`)).toBe("019f8b75");
  });

  it("is null when nothing identifies the session", () => {
    expect(providerSessionId("aider", null, null)).toBeNull();
    expect(providerSessionId("aider", null, "   ")).toBeNull();
  });
});
