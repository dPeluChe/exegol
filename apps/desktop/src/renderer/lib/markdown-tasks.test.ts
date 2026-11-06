import { describe, expect, it } from "vitest";
import { parseTaskBoard, toggleTask } from "./markdown-tasks";

describe("a task file checked out with CRLF", () => {
  const crlf = "## Todo\r\n- [ ] first\r\n- [ ] second\r\n";

  it("reads its headings and tasks", () => {
    const board = parseTaskBoard(crlf, "TASKS.md");
    expect(board.columns.todo.map((t) => t.text)).toEqual(["first", "second"]);
  });

  it("keeps its endings through an edit", () => {
    expect(toggleTask(crlf, 1)).toBe("## Todo\r\n- [x] first\r\n- [ ] second\r\n");
  });
});
