import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectWorkspace } from "./workspace/types";

const storage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
vi.stubGlobal("localStorage", storage);
vi.stubGlobal("window", {
  api: {},
  localStorage: storage,
  addEventListener: () => {},
  dispatchEvent: () => true,
});

const { useWorkspaceStore } = await import("./workspace");
const { useAppStore } = await import("./app");
const { applyFilesView } = await import("./workspace/helpers");

const withFiles = (paneId: string): ProjectWorkspace => ({
  tabs: [{ id: "t", label: "Files", layout: { type: "pane", paneId } }],
  activeTabId: "t",
  panes: { [paneId]: { id: paneId, type: "files" } },
});

const paneOf = (projectId: string, paneId: string) =>
  useWorkspaceStore.getState().projectWorkspaces[projectId]?.panes[paneId];

beforeEach(() => {
  useAppStore.getState().setActiveProject("A");
  useWorkspaceStore.setState({
    projectWorkspaces: { A: withFiles("fa"), B: withFiles("fb") },
    focusedPaneId: "fa",
  });
});

describe("files pane view survives a project switch", () => {
  it("the open file, folders, mode and editor spot come back in their project", () => {
    const set = useWorkspaceStore.getState().setFilesView;
    set("fa", { openFile: "/a/site/index.html" });
    set("fa", { expanded: ["/a/site"], mode: "rendered", runScripts: true });

    useAppStore.getState().setActiveProject("B");
    // Saved while unmounting, after the switch made B active
    set("fa", { cursor: { path: "/a/site/index.html", line: 12, column: 3, scrollTop: 240 } });
    useAppStore.getState().setActiveProject("A");

    expect(paneOf("A", "fa")).toMatchObject({
      openFile: "/a/site/index.html",
      files: {
        expanded: ["/a/site"],
        mode: "rendered",
        runScripts: true,
        cursor: { path: "/a/site/index.html", line: 12, column: 3, scrollTop: 240 },
      },
    });
    expect(paneOf("B", "fb")?.openFile).toBeUndefined();
  });

  it("an unknown pane changes nothing", () => {
    const before = useWorkspaceStore.getState().projectWorkspaces;
    useWorkspaceStore.getState().setFilesView("gone", { openFile: "/x" });
    expect(useWorkspaceStore.getState().projectWorkspaces).toBe(before);
  });
});

describe("applyFilesView", () => {
  const spot = { path: "/r/a.ts", line: 4, column: 1, scrollTop: 60 };

  it("another file starts at its default mode and the top, keeping folders and scripts", () => {
    const pane = applyFilesView(
      {
        id: "p",
        type: "files",
        openFile: "/r/a.ts",
        files: { expanded: ["/r/src"], mode: "rendered", cursor: spot, runScripts: true },
      },
      { openFile: "/r/b.html" },
    );
    expect(pane.openFile).toBe("/r/b.html");
    expect(pane.files).toEqual({
      expanded: ["/r/src"],
      mode: undefined,
      cursor: undefined,
      runScripts: true,
    });
  });

  it("the same file keeps its view; null closes it", () => {
    const pane = { id: "p", type: "files" as const, openFile: "/r/a.ts", files: { cursor: spot } };
    expect(applyFilesView(pane, { openFile: "/r/a.ts" }).files?.cursor).toEqual(spot);
    expect(applyFilesView(pane, { openFile: null }).openFile).toBeUndefined();
  });
});
