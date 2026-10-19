import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { type KeyboardEvent, useRef, useState } from "react";
import { useMountEffect } from "../../hooks/use-mount-effect";
import { useSettings } from "../../hooks/use-trpc";
import { AgentIcon } from "../common/AgentIcon";
import {
  type SendEnterPrefs,
  type SendGroup,
  type SendSections,
  type SendTarget,
  sendHint,
  sendLabel,
} from "./send-targets";
import {
  type SelectionSource,
  sendSelectionTo,
  useCliSessionNames,
  useSendSections,
} from "./use-send-to";

// Per window, in memory only: both the button and the right-click menu open as it was left
let othersExpanded = false;

const SECTION = "px-2 py-0.5 text-[9px] font-semibold text-text-secondary";

interface PickProps {
  onPick: (t: SendTarget) => void;
  /** CLI session names by agent id */
  names: Record<string, string>;
}

function TargetButton({ target, onPick, names }: PickProps & { target: SendTarget }) {
  return (
    <button
      type="button"
      onClick={() => onPick(target)}
      className="flex w-full items-center gap-2 rounded px-2 py-1 text-[11px] text-text-primary outline-none hover:bg-white/10 focus-visible:bg-white/10"
    >
      <AgentIcon provider={target.cliType} size={12} />
      <span className="truncate font-medium">{sendLabel(target, names[target.id])}</span>
    </button>
  );
}

function Group({ group, ...pick }: PickProps & { group: SendGroup }) {
  return (
    <div className="mt-1 border-t border-border/60 pt-1 first:mt-0 first:border-t-0 first:pt-0">
      <p className={SECTION}>{group.projectName}</p>
      {group.targets.map((t) => (
        <TargetButton key={t.id} target={t} {...pick} />
      ))}
    </div>
  );
}

/** Arrows move between the entries, Enter is the focused button's own click */
function moveFocus(e: KeyboardEvent<HTMLDivElement>) {
  const buttons = [...e.currentTarget.querySelectorAll("button")];
  if (buttons.length === 0) return;
  const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
  const next =
    e.key === "ArrowDown"
      ? (at + 1) % buttons.length
      : e.key === "ArrowUp"
        ? (at - 1 + buttons.length) % buttons.length
        : e.key === "Home"
          ? 0
          : e.key === "End"
            ? buttons.length - 1
            : -1;
  if (next === -1) return;
  e.preventDefault();
  buttons[next]?.focus();
}

/** The right-click menu's "Send selection to" page: the same list as the Send to button */
export function SendSelectionMenu({
  source,
  onBack,
  onDone,
}: {
  source: SelectionSource;
  onBack: () => void;
  onDone: () => void;
}) {
  const sections = useSendSections(source.agentId, source.projectId, true);
  return (
    <div className="max-h-80 overflow-y-auto px-1">
      <button
        type="button"
        onClick={onBack}
        className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-[10px] font-medium uppercase tracking-wider text-text-muted hover:bg-white/10"
      >
        <ChevronLeft className="h-3 w-3" />
        Send selection to
      </button>
      <SendToList
        sections={sections}
        getSelection={source.getSelection}
        onSent={onDone}
        onEscape={onDone}
      />
    </div>
  );
}

/** "This project" first, the other projects behind a toggle, what a pick does in the footer.
 *  Shared by the floating Send to button and the terminal's right-click menu */
export function SendToList({
  sections,
  getSelection,
  onSent,
  onEscape,
}: {
  sections: SendSections;
  getSelection: () => string;
  onSent: () => void;
  onEscape: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(othersExpanded);
  const { data: settings } = useSettings();
  const prefs: SendEnterPrefs = {
    sendToRunTerminal: settings?.sendToRunTerminal ?? false,
    sendToSubmitAgent: settings?.sendToSubmitAgent ?? false,
  };
  // A TUI repaint or mouse report can clear the selection while the list is open
  const [opened] = useState(getSelection);
  const names = useCliSessionNames(sections);
  const onPick = (t: SendTarget) => {
    const live = getSelection();
    onSent();
    void sendSelectionTo(live || opened, t, prefs, live ? "live" : "opened");
  };
  const { own, others } = sections;
  // Nothing in this project: the others are the whole list, shown without the extra click
  const showOthers = expanded || !own;
  useMountEffect(() => ref.current?.querySelector("button")?.focus());

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: keyboard navigation over its buttons
    <div
      ref={ref}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onEscape();
          return;
        }
        moveFocus(e);
      }}
    >
      {own && (
        <>
          <p className={SECTION}>This project · {own.projectName}</p>
          {own.targets.map((t) => (
            <TargetButton key={t.id} target={t} onPick={onPick} names={names} />
          ))}
        </>
      )}
      {!own && others.length === 0 && (
        <p className="px-2 py-1 text-[11px] text-text-muted">No live session to send to</p>
      )}
      {own && others.length > 0 && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => {
            othersExpanded = !expanded;
            setExpanded(!expanded);
          }}
          className="mt-1 flex w-full items-center gap-1 rounded border-t border-border/60 px-2 py-1 text-[10px] text-text-muted outline-none hover:bg-white/10 hover:text-text-primary focus-visible:bg-white/10"
        >
          {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          Other projects ({others.length})
        </button>
      )}
      {showOthers &&
        others.map((g) => <Group key={g.projectId} group={g} onPick={onPick} names={names} />)}
      <div className="mt-1 flex items-center justify-between gap-3 border-t border-border/60 px-2 pt-1 text-[9px] text-text-muted">
        <span>{sendHint(prefs)}</span>
        <button
          type="button"
          onClick={() => {
            onEscape();
            void window.api.settings.open("terminal");
          }}
          className="rounded px-1 outline-none hover:text-text-primary focus-visible:bg-white/10"
          title="Settings > Terminal: press Enter after Send to"
        >
          Change
        </button>
      </div>
    </div>
  );
}
