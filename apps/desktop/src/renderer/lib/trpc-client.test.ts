import { describe, expect, it } from "vitest";
import { unwrapIpcError } from "./trpc-client";

describe("unwrapIpcError", () => {
  it("drops Electron's wrapper and gives back the tRPC code", () => {
    const err = unwrapIpcError(
      new Error("Error invoking remote method 'trpc': CONFLICT: Already in Exegol as 'Argos'"),
    );
    expect(err).toMatchObject({ message: "Already in Exegol as 'Argos'", code: "CONFLICT" });
  });

  it("strips an error class name without making it a code", () => {
    const err = unwrapIpcError(new Error("Error invoking remote method 'trpc': Error: boom"));
    expect(err).toMatchObject({ message: "boom" });
    expect(err).not.toHaveProperty("code");
  });

  it("leaves other errors as they are", () => {
    const plain = Object.assign(new Error("Capability denied: x"), { code: "FORBIDDEN" });
    expect(unwrapIpcError(plain)).toBe(plain);
    expect(unwrapIpcError("text")).toBe("text");
  });
});
