import type { CapturedElement } from "./design-capture";

/** The follow-up an agent gets from the pane's "Ask agent": where the user is, what they picked,
 *  and the tool that shows it the page */
export function buildAskAgentMessage(input: {
  paneId: string;
  url: string;
  title: string;
  note: string;
  element: CapturedElement | null;
}): string {
  const lines = [
    `[Exegol browser] The user is asking you about the page in browser pane "${input.paneId}".`,
    `URL: ${input.url}`,
  ];
  if (input.title.trim()) lines.push(`Title: ${input.title.trim().slice(0, 200)}`);
  if (input.note.trim()) lines.push(`Note: ${input.note.trim()}`);
  if (input.element) {
    const text = input.element.textContent.replace(/\s+/g, " ").trim().slice(0, 200);
    lines.push(
      `Selected element: ${input.element.selector} <${input.element.tagName.toLowerCase()}>${text ? ` "${text}"` : ""}`,
    );
  }
  lines.push(
    `Call browser_snapshot with pane "${input.paneId}" to see the page (Exegol MCP tools).`,
  );
  return lines.join("\n");
}
