import { useAgentStore } from "../../stores/agents";
import { useToastStore } from "../../stores/toasts";
import { pasteToAgent, submitToAgent } from "../agent-input";
import { agentAsksQuestion } from "../agent-question";
import { paneRoot } from "../pane-focus";
import { insertIntoEditorIn } from "./editors";
import { type DictationTarget, takesDictation } from "./target";

const toast = useToastStore.getState;

/** The mic gave no signal or the model found no words: say which input, not just nothing */
export function heardNothing(inputName: string | null): void {
  toast().addToast({
    type: "warning",
    title: `Heard nothing from ${inputName || "the microphone"}`,
    body: "Check the input in Settings > Dictation",
    action: { label: "Open Settings", run: () => void window.api.settings.open("dictation") },
  });
}

export async function copyInstead(text: string, title: string, body: string): Promise<void> {
  await navigator.clipboard.writeText(text).catch(() => {});
  toast().addToast({ type: "info", title, body });
}

/** Why the text must not be typed into the agent: it ended, or a dictation would answer its
 *  question. Null when it can take it */
async function terminalRefusal(agentId: string): Promise<string | null> {
  const agent = useAgentStore.getState().agents[agentId];
  if (!agent || !takesDictation(agent)) return "The agent is not running";
  return (await agentAsksQuestion(agentId)) ? "The agent is waiting on a question" : null;
}

export async function insertDictation(
  text: string,
  target: DictationTarget,
  pressEnter: boolean,
  field: HTMLElement | null,
): Promise<void> {
  if (target.kind === "terminal") {
    const refusal = await terminalRefusal(target.agentId);
    if (refusal) {
      return copyInstead(text, "Dictation copied, not typed", `${refusal}: paste it yourself`);
    }
    if (pressEnter) submitToAgent(target.agentId, text, true);
    else pasteToAgent(target.agentId, text, true);
    return;
  }
  if (target.kind === "browser") {
    const ok = await window.api.dictation
      .insertInBrowser({ paneId: target.paneId, projectId: target.projectId, text })
      .catch(() => false);
    if (ok) return;
    return copyInstead(
      text,
      "Dictation copied",
      "The page changed, is outside the project's hosts, or no editable field has the focus",
    );
  }
  if (target.kind === "editor") {
    const root = paneRoot(target.paneId);
    if (root && insertIntoEditorIn(root, text)) return;
  }
  if (target.kind === "field" && field) {
    field.focus();
    if (document.execCommand("insertText", false, text)) return;
  }
  const why = target.kind === "clipboard" ? target.why : undefined;
  return copyInstead(
    text,
    "Dictation copied",
    why
      ? `${why}: paste it where you need it`
      : "No focused pane could take it: paste it where you need it",
  );
}
