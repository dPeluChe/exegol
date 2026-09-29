import {
  type AgentAccessMode,
  type AgentProvider,
  type ResumableSession,
  YOLO_FLAGS,
} from "@exegol/shared";
import { useCallback, useState } from "react";

/** One 3-way choice, one state: a new session, the CLI's own last one, or a
 *  specific past session. Two booleans could represent the impossible pair. */
export type SessionChoice = ResumableSession | "last" | null;

/** Per-project spawn preference. A UI default, deliberately not app config:
 *  it is remembered, never synced, and a wrong value costs one checkbox click. */
const WORKTREE_PREF_KEY = "exegol.spawn.useWorktree";

function readWorktreePreference(projectId: string): boolean {
  try {
    const raw = localStorage.getItem(`${WORKTREE_PREF_KEY}.${projectId}`);
    return raw === null ? false : raw === "1";
  } catch {
    return false;
  }
}

function writeWorktreePreference(projectId: string, value: boolean): void {
  try {
    localStorage.setItem(`${WORKTREE_PREF_KEY}.${projectId}`, value ? "1" : "0");
  } catch {
    /* private mode / quota — the default just won't stick */
  }
}

interface SpawnFormInit {
  projectId: string;
  enabledProviders: AgentProvider[];
  initialProvider?: AgentProvider;
  initialTask?: string;
  initialCliType?: string;
  initialSession: SessionChoice;
  initialAccessMode: AgentAccessMode;
}

/** What the user picked in the launch modal, and the handlers that keep the picks consistent. */
export function useSpawnForm({
  projectId,
  enabledProviders,
  initialProvider,
  initialTask,
  initialCliType,
  initialSession,
  initialAccessMode,
}: SpawnFormInit) {
  const [task, setTask] = useState(initialTask ?? "");
  const [pickedProviderId, setPickedProviderId] = useState(
    initialCliType ?? initialProvider?.id ?? "",
  );
  const [accessMode, setAccessMode] = useState<AgentAccessMode>(initialAccessMode);
  // Remembered per project: whether a repo is worked in parallel branches or by
  // several agents on ONE branch is a property of how that project is run, not
  // a per-spawn decision. Defaulting to "isolated" every time meant unchecking
  // it on every single launch for review-style work (Antonio, 2026-08-13).
  const [useWorktree, setUseWorktree] = useState(() => readWorktreePreference(projectId));
  const [branchName, setBranchName] = useState("");
  const [branchEdited, setBranchEdited] = useState(false);
  const [selectedSkills, setSelectedSkills] = useState<Set<string>>(new Set());
  const [session, setSession] = useState<SessionChoice>(initialSession);
  /** null = inherit the provider's configured args; a boolean overrides it. */
  const [yolo, setYolo] = useState<boolean | null>(null);
  /** T177: ref the worktree is cut from. Empty = the project's current branch. */
  const [baseBranch, setBaseBranch] = useState("");
  // Claude's own sessions in this folder, by /rename name: --continue only reaches the latest
  const [localSessionId, setLocalSessionId] = useState<string | null>(null);

  // None picked yet: the first enabled provider
  const providerId = pickedProviderId || enabledProviders[0]?.id || "";
  const provider = enabledProviders.find((p) => p.id === providerId);

  // Switching provider must drop a selection that belongs to the old one —
  // "Continue last" included: left set, it sent resumeSession for a CLI with no
  // resume flag at all.
  const chooseProvider = (id: string) => {
    setPickedProviderId(id);
    setSession((current) =>
      current === "last" || (current && current.cliType !== id) ? null : current,
    );
    setLocalSessionId(null);
  };

  const chooseSession = (choice: SessionChoice) => {
    setSession(choice);
    setLocalSessionId(null);
  };

  const chooseLocalSession = (id: string | null) => {
    setLocalSessionId(id);
    setSession(null);
  };

  const chooseWorktree = (isolated: boolean) => {
    setUseWorktree(isolated);
    writeWorktreePreference(projectId, isolated);
  };

  const editBranch = (value: string) => {
    setBranchName(value);
    setBranchEdited(true);
  };

  const toggleSkill = useCallback((name: string) => {
    setSelectedSkills((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  return {
    task,
    setTask,
    providerId,
    provider,
    yoloFlag: YOLO_FLAGS[providerId],
    chooseProvider,
    accessMode,
    setAccessMode,
    useWorktree,
    chooseWorktree,
    branchName,
    branchEdited,
    editBranch,
    baseBranch,
    setBaseBranch,
    selectedSkills,
    toggleSkill,
    session,
    chooseSession,
    localSessionId,
    chooseLocalSession,
    yolo,
    setYolo,
  };
}

export type SpawnForm = ReturnType<typeof useSpawnForm>;
