import { beforeEach, describe, expect, it } from "vitest";
import { useShortcutStore } from "./shortcuts";

const { assign } = useShortcutStore.getState();
const assigned = () => useShortcutStore.getState().assigned;

describe("useShortcutStore.assign", () => {
  beforeEach(() => useShortcutStore.setState({ assigned: {} }));

  it("giving a number to a project takes it from the one that had it", () => {
    assign("a", "3");
    assign("b", "3");
    expect(assigned()).toEqual({ b: "3" });
  });

  it("a new number replaces the project's old one", () => {
    assign("a", "3");
    assign("a", "5");
    expect(assigned()).toEqual({ a: "5" });
  });

  it("null frees the project's number (Automatic, or the project was removed)", () => {
    assign("a", "3");
    assign("b", "4");
    assign("a", null);
    expect(assigned()).toEqual({ b: "4" });
  });
});
