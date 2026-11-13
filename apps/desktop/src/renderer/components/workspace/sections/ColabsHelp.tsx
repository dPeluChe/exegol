import { Button } from "@exegol/ui";

const STEPS: { title: string; body: string }[] = [
  {
    title: "Join the projects",
    body: "A colab joins projects that work together, such as a blueprint and its clones. You create it, write what it is for, and add the projects as members. Agents cannot create one.",
  },
  {
    title: "Sessions learn about it",
    body: "A session started in a member project is told the colab's name, its purpose and the other members. It can post a thread to the colab, for every member or for one of them.",
  },
  {
    title: "Threads wait for you",
    body: "A thread shows here and in the Inbox of each member project. It never wakes a session: open it and send it to a session, or answer it yourself.",
  },
  {
    title: "You close the loop",
    body: "After six messages between agents a person decides what happens next. Closing a thread takes one line saying how it ended, and it moves to Archived.",
  },
];

/** What a colab is and how a thread travels, until the person hides it */
export function ColabsHelp({ onNew, onHide }: { onNew: () => void; onHide: () => void }) {
  return (
    <div className="flex flex-col gap-3 p-4 text-xs">
      <h3 className="text-sm font-semibold text-text-primary">How colabs work</h3>
      <ol className="flex flex-col gap-2.5">
        {STEPS.map((step, i) => (
          <li key={step.title} className="flex gap-2.5">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border text-[10px] tabular-nums text-text-muted">
              {i + 1}
            </span>
            <span className="min-w-0 leading-relaxed text-text-secondary">
              <span className="font-medium text-text-primary">{step.title}.</span> {step.body}
            </span>
          </li>
        ))}
      </ol>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={onNew}>
          New colab
        </Button>
        <Button size="sm" variant="ghost" onClick={onHide}>
          Hide this
        </Button>
      </div>
    </div>
  );
}
