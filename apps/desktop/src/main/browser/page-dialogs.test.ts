import { describe, expect, it } from "vitest";
import {
  allowPageClipboard,
  CLIPBOARD_GESTURE_MS,
  isUserGesture,
  originOf,
} from "./clipboard-policy";
import {
  addPending,
  answerPending,
  cancelPendingOf,
  decidePageDialog,
  dialogHost,
  dialogNote,
  dialogResult,
  dropPendingOf,
  isDialogFlood,
  noteDialog,
  pendingCountOf,
  pendingOnPane,
  recentDialogs,
  takeDialogNotes,
  withDialogNotes,
} from "./page-dialogs";
import { MAX_PENDING_PER_PAGE } from "./pending-store";

const ctx = {
  hasPane: true,
  agentActing: false,
  userGestureAfterAgent: false,
  pendingOnPage: 0,
  blocked: false,
};

describe("decidePageDialog", () => {
  it("shows every dialog in the pane when no agent is acting", () => {
    for (const t of ["alert", "confirm", "prompt"] as const) {
      expect(decidePageDialog(t, ctx)).toBe("show");
    }
  });
  it("never lets an acting agent wait: alerts close, questions are cancelled", () => {
    const acting = { ...ctx, agentActing: true };
    expect(decidePageDialog("alert", acting)).toBe("accept");
    expect(decidePageDialog("confirm", acting)).toBe("cancel");
    expect(decidePageDialog("prompt", acting)).toBe("cancel");
  });
  it("shows a dialog the user raised after the agent's last action", () => {
    const user = { ...ctx, agentActing: true, userGestureAfterAgent: true };
    expect(decidePageDialog("confirm", user)).toBe("show");
  });
  it("keeps Electron's own dialog for a webview in no pane", () => {
    expect(decidePageDialog("confirm", { ...ctx, hasPane: false })).toBe("native");
    expect(decidePageDialog("alert", { ...ctx, hasPane: false, agentActing: true })).toBe("native");
  });
  it("cancels past the per-page cap and while the user blocked the page", () => {
    const full = { ...ctx, pendingOnPage: MAX_PENDING_PER_PAGE };
    expect(decidePageDialog("prompt", full)).toBe("cancel");
    expect(decidePageDialog("alert", full)).toBe("accept");
    expect(decidePageDialog("confirm", { ...ctx, pendingOnPage: MAX_PENDING_PER_PAGE - 1 })).toBe(
      "show",
    );
    expect(
      decidePageDialog("confirm", { ...ctx, blocked: true, userGestureAfterAgent: true }),
    ).toBe("cancel");
  });
});

describe("dialog flood", () => {
  it("offers the block from the third dialog within the window", () => {
    let recent = recentDialogs([], 0);
    recent = recentDialogs(recent, 1_000);
    expect(isDialogFlood(recent)).toBe(false);
    recent = recentDialogs(recent, 2_000);
    expect(isDialogFlood(recent)).toBe(true);
    expect(isDialogFlood(recentDialogs(recent, 60_000))).toBe(false);
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
      notifyClosed: () => {},
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
      notifyClosed: () => {},
    });
    expect(dropPendingOf(9).map((d) => d.id)).toEqual(["d2"]);
    expect(answered).toBe(false);
    expect(pendingOnPane("p3")).toBeUndefined();
  });
});

describe("cap and block", () => {
  it("counts a page's dialogs and cancels them all, closing their bars", () => {
    const got: boolean[] = [];
    let closed = 0;
    for (const id of ["c1", "c2"]) {
      addPending({
        id,
        wcId: 11,
        paneId: "p4",
        type: "confirm",
        host: "",
        answer: (ok) => got.push(ok),
        notifyClosed: () => {
          closed += 1;
        },
      });
    }
    expect(pendingCountOf(11)).toBe(2);
    cancelPendingOf(11);
    expect(got).toEqual([false, false]);
    expect(closed).toBe(2);
    expect(pendingCountOf(11)).toBe(0);
  });
});

describe("allowPageClipboard", () => {
  const base = {
    agentActing: false,
    sinceUserInput: 100,
    inputOrigin: "http://localhost:3000",
    requestOrigin: "http://localhost:3000",
  };
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
  it("never lets another site read off a click on the previous one", () => {
    const read = { ...base, permission: "clipboard-read" };
    expect(allowPageClipboard({ ...read, requestOrigin: "https://evil.example" })).toBe(false);
    expect(allowPageClipboard({ ...read, inputOrigin: null, requestOrigin: null })).toBe(false);
    expect(originOf("http://localhost:3000/a?b")).toBe("http://localhost:3000");
    expect(originOf("about:blank")).toBeNull();
  });
  it("counts clicks and keys as gestures, not moves", () => {
    expect(isUserGesture("mouseDown")).toBe(true);
    expect(isUserGesture("rawKeyDown")).toBe(true);
    expect(isUserGesture("mouseMove")).toBe(false);
    expect(isUserGesture(undefined)).toBe(false);
  });
});
