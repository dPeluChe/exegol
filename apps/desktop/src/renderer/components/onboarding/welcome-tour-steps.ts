import { appKeys, editKeys } from "../../lib/keymap";

export interface WelcomeTourStep {
  title: string;
  bullets: string[];
}

/** Written with macOS keys; WELCOME_TOUR_STEPS shows them for the running platform */
const MAC_STEPS: WelcomeTourStep[] = [
  {
    title: "Welcome to Exegol",
    bullets: [
      "Run and supervise AI coding agents from one window: Claude Code, Codex, Gemini, Antigravity, OpenCode, Devin, Aider and more.",
      "Each project gets its own tabs, panes and agents.",
      "Agent sessions keep running when you reload or restart the app.",
    ],
  },
  {
    title: "Projects and agents",
    bullets: [
      "Add a project by picking its folder.",
      "Launch an agent from an empty pane or with Cmd+N.",
      "Run it in the project checkout or in its own worktree and branch, and pick its access mode.",
      "An empty pane lists past sessions you can resume.",
      "Start a CLI by hand in a terminal and that terminal becomes the agent.",
    ],
  },
  {
    title: "Layouts",
    bullets: [
      "Split the focused pane with Cmd+D or Cmd+Shift+D.",
      "A pane can be a terminal, a browser, files or git.",
      "Pick a layout preset from the tab bar, or save your own.",
      "Right-click a terminal or browser pane to float it to its own window.",
      "Ctrl+Tab (or Cmd+] / Cmd+[) moves between the panes of a tab.",
    ],
  },
  {
    title: "Working in terminals",
    bullets: [
      "Select text and use Send to: it pastes into another agent without submitting.",
      "Open Files beside the terminal from its toolbar.",
      "Cmd+click a link or a file path to open it.",
      "Right-click for Clear Terminal and Refresh Terminal.",
    ],
  },
  {
    title: "Supervise your agents",
    bullets: [
      "Cmd+1 opens the Dashboard with every agent across projects.",
      "Pin sessions to Watching to follow them live side by side.",
      "Needs attention in the sidebar lists agents waiting on you; Cmd+J jumps to the next one.",
      "Cmd+2..9 and Cmd+0 jump to your live tabs (set a project's number in Edit project).",
      "Dashboard cards show the messages agents send each other.",
    ],
  },
  {
    title: "Git and review",
    bullets: [
      "The git pane shows your changes and diffs.",
      "The Smart Git button picks the next step: commit, push, create or merge the PR.",
      "The oplog records agent operations so you can undo them.",
      "Pipelines in the Project tab chain agents into multi-step runs.",
    ],
  },
  {
    title: "Getting help",
    bullets: [
      "Cmd+/ lists every keyboard shortcut; Cmd+K opens the command palette.",
      "Cmd+, opens Settings in its own window.",
      "The bug button in the title bar files a report you review first.",
      "When an update is ready, the update button shows what's new.",
      "Reopen this tour any time from the command palette.",
    ],
  },
];

export const WELCOME_TOUR_STEPS: WelcomeTourStep[] = MAC_STEPS.map((step) => ({
  ...step,
  bullets: step.bullets.map((b) => (b.includes("Cmd+click") ? editKeys(b) : appKeys(b))),
}));
