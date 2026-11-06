import { create } from "zustand";

/** Moving between sessions remounts the chat input: what was being typed waits for the way back */
export const useChatDraftStore = create<{ drafts: Record<string, string> }>(() => ({
  drafts: {},
}));

export function setChatDraft(agentId: string, text: string): void {
  const { drafts } = useChatDraftStore.getState();
  if ((drafts[agentId] ?? "") === text) return;
  const { [agentId]: _, ...rest } = drafts;
  useChatDraftStore.setState({ drafts: text ? { ...rest, [agentId]: text } : rest });
}
