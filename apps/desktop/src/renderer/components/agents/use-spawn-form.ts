import {
  type AgentAccessMode,
  type AgentProvider,
  MODEL_ID_PATTERN,
  type ResumableSession,
  YOLO_FLAGS,
} from "@exegol/shared";
import { useCallback, useState } from "react";
import { isLaunchable } from "../../hooks/use-providers";

/** One 3-way choice, one state: a new session, the CLI's own last one, or a
 *  specific past session. Two booleans could represent the impossible pair. */
export type SessionChoice = ResumableSession | "last" | null;

/** Launched with YOLO checked unless the user unticks it (Antonio, 2026-10-08) */
const YOLO_DEFAULT_ON = new Set(["claude-code"]);

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
  initialBranch?: string | null;
  /** The launcher's folder when not the project root: the agent starts there, never a worktree */
  folder?: string;
}

/** Switching agent drops a session that belongs to the old one, "Continue last" included: left
 *  set, it sent resumeSession for a CLI with no resume flag */
export function sessionAfterSwitch(current: SessionChoice, providerId: string): SessionChoice {
  return current === "last" || (current && current.cliType !== providerId) ? null : current;
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
  initialBranch,
  folder,
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
  const [useWorktree, setUseWorktree] = useState(
    () => !!initialBranch || readWorktreePreference(projectId),
  );
  const [branchName, setBranchName] = useState(initialBranch ?? "");
  const [branchEdited, setBranchEdited] = useState(!!initialBranch);
  const [selectedSkills, setSelectedSkills] = useState<Set<string>>(new Set());
  const [session, setSession] = useState<SessionChoice>(initialSession);
  /** null = inherit the provider's configured args; a boolean overrides it. */
  const [yolo, setYolo] = useState<boolean | null>(null);
  /** T177: ref the worktree is cut from. Empty = the project's current branch. */
  const [baseBranch, setBaseBranch] = useState("");
  // Claude's own sessions in this folder, by /rename name: --continue only reaches the latest
  const [localSessionId, setLocalSessionId] = useState<string | null>(null);
  const [model, setModel] = useState("");
  const [modelRoles, setModelRoles] = useState<Record<string, string>>({});
  const [name, setName] = useState("");

  // None picked yet: the first enabled provider
  const providerId =
    pickedProviderId || (enabledProviders.find(isLaunchable) ?? enabledProviders[0])?.id || "";
  const provider = enabledProviders.find((p) => p.id === providerId);

  // Folder, prompt and mode stay; the session, model and roles belong to the old agent
  const chooseProvider = (id: string) => {
    setPickedProviderId(id);
    setSession((current) => sessionAfterSwitch(current, id));
    setLocalSessionId(null);
    // A model id belongs to one CLI
    setModel("");
    setModelRoles({});
  };

  const setModelRole = (roleId: string, value: string) =>
    setModelRoles((prev) => {
      const next = { ...prev, [roleId]: value };
      if (!value) delete next[roleId];
      return next;
    });

  const applyPreset = (preset: { model: string; roles: Record<string, string> }) => {
    setModel(preset.model);
    setModelRoles(preset.roles);
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
    useWorktree: useWorktree && !folder,
    chooseWorktree,
    folder,
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
    // A resume keeps the YOLO choice its session was launched with
    yolo: yolo ?? (YOLO_DEFAULT_ON.has(providerId) && !session && !localSessionId ? true : null),
    setYolo,
    model,
    setModel,
    modelRoles,
    setModelRole,
    applyPreset,
    name,
    setName,
  };
}

export type SpawnForm = ReturnType<typeof useSpawnForm>;

/** Launchable: an agent picked and installed, a valid model id, not already launching */
export function canLaunchForm(
  form: Pick<SpawnForm, "providerId" | "provider" | "model">,
  spawning: boolean,
): boolean {
  const model = form.model.trim();
  const modelOk = !model || MODEL_ID_PATTERN.test(model);
  return !!form.providerId && modelOk && form.provider?.installed !== false && !spawning;
}
