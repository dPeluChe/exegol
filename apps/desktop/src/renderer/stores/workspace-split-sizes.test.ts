import { describe, expect, it, vi } from "vitest";

const storage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
vi.stubGlobal("localStorage", storage);
vi.stubGlobal("window", {
  api: {},
  localStorage: storage,
  addEventListener: () => {},
  dispatchEvent: () => true,
});

describe("setSplitSizes", () => {
  it("stores a drag on the split it happened in, nested ones included", async () => {
    const { useWorkspaceStore } = await import("./workspace");
    const { useAppStore } = await import("./app");
    useAppStore.setState({ activeProjectId: "p1" });
    useWorkspaceStore.setState({
      _activeProjectId: "p1",
      projectWorkspaces: {
        p1: {
          activeTabId: "t1",
          panes: {},
          tabs: [
            {
              id: "t1",
              label: "Tab",
              layout: {
                type: "split",
                direction: "horizontal",
                sizes: [50, 50],
                children: [
                  { type: "pane", paneId: "a" },
                  {
                    type: "split",
                    direction: "vertical",
                    sizes: [50, 50],
                    children: [
                      { type: "pane", paneId: "b" },
                      { type: "pane", paneId: "c" },
                    ],
                  },
                ],
              },
            },
          ],
        },
      },
    });
    const store = useWorkspaceStore.getState();
    store.setSplitSizes("t1", [1], [70, 30]);
    store.setSplitSizes("t1", [], [40, 60]);
    const layout = useWorkspaceStore.getState().projectWorkspaces.p1?.tabs[0]?.layout;
    expect(layout?.type === "split" && layout.sizes).toEqual([40, 60]);
    const inner = layout?.type === "split" ? layout.children[1] : undefined;
    expect(inner?.type === "split" && inner.sizes).toEqual([70, 30]);

    // The same sizes again change nothing (no re-render storm while dragging)
    const before = useWorkspaceStore.getState().projectWorkspaces;
    store.setSplitSizes("t1", [], [40, 60]);
    expect(useWorkspaceStore.getState().projectWorkspaces).toBe(before);
  });
});
