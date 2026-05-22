import type { Terminal } from "@xterm/xterm";
import { describe, expect, it, vi } from "vitest";
import { createShellIntegrationState, registerOscHandlers } from "./osc-handlers";

type OscHandler = (data: string) => boolean | Promise<boolean>;

function makeFakeTerm() {
  const handlers = new Map<number, OscHandler>();
  const term = {
    parser: {
      registerOscHandler(code: number, handler: OscHandler) {
        handlers.set(code, handler);
        return { dispose: () => handlers.delete(code) };
      },
    },
    registerMarker: vi.fn().mockReturnValue({ isDisposed: false, dispose: vi.fn() }),
  } as unknown as Terminal;
  return { term, handlers };
}

function makeDeps() {
  const setCwd = vi.fn<(cwd: string) => void>();
  const setLastExit = vi.fn<(code: number | null) => void>();
  return { setCwd, setLastExit };
}

describe("registerOscHandlers — OSC 7 cwd", () => {
  it("extracts cwd from a well-formed OSC 7 sequence at the prompt context", () => {
    const { term, handlers } = makeFakeTerm();
    const deps = makeDeps();
    registerOscHandlers(term, deps);
    // Our local shell's precmd emits D then OSC 7 then A on every prompt;
    // D drops us into the trusted prompt context.
    handlers.get(133)?.("D;0");
    handlers.get(7)?.("file://host/home/me/project");
    expect(deps.setCwd).toHaveBeenCalledWith("/home/me/project");
  });

  it("normalizes Windows drive-letter paths", () => {
    const { term, handlers } = makeFakeTerm();
    const deps = makeDeps();
    registerOscHandlers(term, deps);
    handlers.get(7)?.("file:///C:/Users/me/project");
    expect(deps.setCwd).toHaveBeenCalledWith("C:/Users/me/project");
  });

  it("URL-decodes percent escapes", () => {
    const { term, handlers } = makeFakeTerm();
    const deps = makeDeps();
    registerOscHandlers(term, deps);
    handlers.get(7)?.("file://host/home/me/with%20space");
    expect(deps.setCwd).toHaveBeenCalledWith("/home/me/with space");
  });

  it("rejects OSC 7 emitted while a command is running (SSH spoofing guard)", () => {
    const { term, handlers } = makeFakeTerm();
    const state = createShellIntegrationState();
    const deps = makeDeps();
    registerOscHandlers(term, deps, state);
    handlers.get(133)?.("D;0");
    handlers.get(133)?.("B");
    handlers.get(7)?.("file://attacker/etc");
    expect(deps.setCwd).not.toHaveBeenCalled();
  });

  it("rejects OSC 7 when a remote shell emits 133;A inside our local command", () => {
    // Bypass attempted by Terax's pattern: a remote shell with its own
    // integration emits 133;A mid-command. Hardened guard does NOT flip
    // inCommand=false on A, so the local pane's cwd stays untouched.
    const { term, handlers } = makeFakeTerm();
    const state = createShellIntegrationState();
    const deps = makeDeps();
    registerOscHandlers(term, deps, state);
    handlers.get(133)?.("D;0"); // local prompt context
    handlers.get(133)?.("C"); // local command starts (ssh remote)
    handlers.get(133)?.("A"); // remote shell's prompt — must NOT clear guard
    handlers.get(7)?.("file://attacker/etc");
    expect(deps.setCwd).not.toHaveBeenCalled();
  });

  it("re-accepts OSC 7 after the command finishes (OSC 133 D)", () => {
    const { term, handlers } = makeFakeTerm();
    const state = createShellIntegrationState();
    const deps = makeDeps();
    registerOscHandlers(term, deps, state);
    handlers.get(133)?.("D;0");
    handlers.get(133)?.("B");
    handlers.get(7)?.("file://attacker/etc");
    handlers.get(133)?.("D;0"); // command exited
    handlers.get(7)?.("file://host/home/me/new-cwd");
    expect(deps.setCwd).toHaveBeenCalledTimes(1);
    expect(deps.setCwd).toHaveBeenCalledWith("/home/me/new-cwd");
  });

  it("malformed OSC 7 payloads do not crash and emit no cwd", () => {
    const { term, handlers } = makeFakeTerm();
    const deps = makeDeps();
    registerOscHandlers(term, deps);
    handlers.get(7)?.("garbage");
    handlers.get(7)?.("");
    handlers.get(7)?.("file:");
    expect(deps.setCwd).not.toHaveBeenCalled();
  });
});

describe("registerOscHandlers — OSC 133 state machine", () => {
  it("inCommand transitions: A is a no-op; B/C set true; D resets false", () => {
    const { term, handlers } = makeFakeTerm();
    const state = createShellIntegrationState();
    const deps = makeDeps();
    registerOscHandlers(term, deps, state);

    handlers.get(133)?.("A");
    expect(state.inCommand).toBe(false);
    handlers.get(133)?.("B");
    expect(state.inCommand).toBe(true);
    // A while inCommand=true must NOT clear the guard (remote-A bypass).
    handlers.get(133)?.("A");
    expect(state.inCommand).toBe(true);
    handlers.get(133)?.("C");
    expect(state.inCommand).toBe(true);
    handlers.get(133)?.("D;0");
    expect(state.inCommand).toBe(false);
  });

  it("OSC 133 D;<n> surfaces the exit code", () => {
    const { term, handlers } = makeFakeTerm();
    const deps = makeDeps();
    registerOscHandlers(term, deps);
    handlers.get(133)?.("D;0");
    expect(deps.setLastExit).toHaveBeenLastCalledWith(0);
    handlers.get(133)?.("D;127");
    expect(deps.setLastExit).toHaveBeenLastCalledWith(127);
  });

  it("OSC 133 D without exit code does NOT clobber the previously-stored value", () => {
    const { term, handlers } = makeFakeTerm();
    const deps = makeDeps();
    registerOscHandlers(term, deps);
    handlers.get(133)?.("D;0");
    expect(deps.setLastExit).toHaveBeenLastCalledWith(0);
    handlers.get(133)?.("D"); // bare D from a foreign integration
    // setLastExit must not be called again with null — the store keeps 0.
    expect(deps.setLastExit).toHaveBeenCalledTimes(1);
  });

  it("registers a prompt marker on OSC 133 A", () => {
    const { term, handlers } = makeFakeTerm();
    const deps = makeDeps();
    const result = registerOscHandlers(term, deps);
    handlers.get(133)?.("A");
    expect(result.getPromptMarker()).not.toBeNull();
  });

  it("dispose() unregisters handlers", () => {
    const { term, handlers } = makeFakeTerm();
    const deps = makeDeps();
    const result = registerOscHandlers(term, deps);
    result.dispose();
    expect(handlers.has(7)).toBe(false);
    expect(handlers.has(133)).toBe(false);
  });
});
