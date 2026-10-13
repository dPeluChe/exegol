import { describe, expect, it } from "vitest";
import { allowPageClipboard, CLIPBOARD_GESTURE_MS, isUserGesture } from "./clipboard-policy";
import {
  addPending,
  answerPending,
  decidePageDialog,
  dialogHost,
  dialogNote,
  dialogResult,
  dropPendingOf,
  noteDialog,
  pendingOnPane,
  takeDialogNotes,
  withDialogNotes,
} from "./page-dialogs";

describe("decidePageDialog", () => {
  it("shows every dialog in the pane when no agent is acting", () => {
    for (const t of ["alert", "confirm", "prompt"] as const) {
      expect(decidePageDialog(t, { registered: true, agentActing: false })).toBe("show");
    }
  });
  it("never lets an acting agent wait: alerts close, questions are cancelled", () => {
    const acting = { registered: true, agentActing: true };
    expect(decidePageDialog("alert", acting)).toBe("accept");
    expect(decidePageDialog("confirm", acting)).toBe("cancel");
    expect(decidePageDialog("prompt", acting)).toBe("cancel");
  });
  it("answers a page in no pane without showing anything", () => {
    const none = { registered: false, agentActing: false };
    expect(decidePageDialog("alert", none)).toBe("accept");
    expect(decidePageDialog("confirm", none)).toBe("cancel");
  });
});

describe("dialogResult", () => {
  it("keeps the page semantics: confirm boolean, prompt text or null", () => {
    expect(dialogResult("alert", false, "x")).toEqual({ ok: true, text: "" });
    expect(dialogResult("confirm", true, "x")).toEqual({ ok: true, text: "" });
    expect(dialogResult("prompt", true, "hi")).toEqual({ ok: true, text: "hi" });
    expect(dialogResult("prompt", false, "hi")).toEqual({ ok: false, text: "" });
    expect(dialogResult("prompt", true, 42)).toEqual({ ok: true, text: "" });
  });
});

describe("dialogHost", () => {
  it("shows host:port for web pages and the scheme otherwise", () => {
    expect(dialogHost("http://localhost:3000/a?b")).toBe("localhost:3000");
    expect(dialogHost("about:blank")).toBe("about");
    expect(dialogHost("nope")).toBe("");
    expect(dialogHost(undefined)).toBe("");
  });
});

describe("agent notes", () => {
  it("queues notes per pane and hands them out once", () => {
    noteDialog("p1", dialogNote("alert", "localhost:3000", "accept"));
    noteDialog("p1", dialogNote("confirm", "localhost:3000", "cancel"));
    const notes = takeDialogNotes("p1");
    expect(notes).toEqual([
      "page_dialog: alert on localhost:3000",
      "page_dialog: confirm on localhost:3000 (cancelled)",
    ]);
    expect(takeDialogNotes("p1")).toEqual([]);
    const out = withDialogNotes({ status: "ok" }, notes) as Record<string, unknown>;
    expect(out.page_dialogs).toEqual(notes);
    expect(out.page_dialog_hint).toContain("browser_wait_for_user");
  });
  it("leaves results alone without notes, and an alert needs no hint", () => {
    const r = { status: "ok" };
    expect(withDialogNotes(r, [])).toBe(r);
    const out = withDialogNotes(r, ["page_dialog: alert on x"]) as Record<string, unknown>;
    expect(out.page_dialog_hint).toBeUndefined();
  });
});

describe("pending dialogs", () => {
  it("answers once, through the type's semantics", () => {
    const got: [boolean, string][] = [];
    addPending({
      id: "d1",
      wcId: 7,
      paneId: "p2",
      type: "prompt",
      host: "localhost",
      answer: (ok, text) => got.push([ok, text]),
    });
    expect(pendingOnPane("p2")?.id).toBe("d1");
    expect(answerPending("d1", true, "name")).toBe(true);
    expect(answerPending("d1", true, "again")).toBe(false);
    expect(got).toEqual([[true, "name"]]);
    expect(pendingOnPane("p2")).toBeUndefined();
  });
  it("drops a webview's dialogs without answering them", () => {
    let answered = false;
    addPending({
      id: "d2",
      wcId: 9,
      paneId: "p3",
      type: "alert",
      host: "",
      answer: () => {
        answered = true;
      },
    });
    expect(dropPendingOf(9).map((d) => d.id)).toEqual(["d2"]);
    expect(answered).toBe(false);
    expect(pendingOnPane("p3")).toBeUndefined();
  });
});

describe("allowPageClipboard", () => {
  const base = { agentActing: false, sinceUserInput: 100 };
  it("allows writes and leaves other permissions to the caller", () => {
    expect(allowPageClipboard({ ...base, permission: "clipboard-sanitized-write" })).toBe(true);
    expect(allowPageClipboard({ ...base, permission: "media" })).toBeNull();
    expect(allowPageClipboard({ ...base, permission: "deprecated-sync-clipboard-read" })).toBe(
      false,
    );
  });
  it("reads only right after the user's own input, never while an agent acts", () => {
    const read = { ...base, permission: "clipboard-read" };
    expect(allowPageClipboard(read)).toBe(true);
    expect(allowPageClipboard({ ...read, agentActing: true })).toBe(false);
    expect(allowPageClipboard({ ...read, sinceUserInput: null })).toBe(false);
    expect(allowPageClipboard({ ...read, sinceUserInput: CLIPBOARD_GESTURE_MS })).toBe(false);
  });
  it("counts clicks and keys as gestures, not moves", () => {
    expect(isUserGesture("mouseDown")).toBe(true);
    expect(isUserGesture("rawKeyDown")).toBe(true);
    expect(isUserGesture("mouseMove")).toBe(false);
    expect(isUserGesture(undefined)).toBe(false);
  });
});
