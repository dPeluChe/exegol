import { useCallback, useState } from "react";

/** Persist task file path per project in localStorage */
export function usePersistedTaskFile(projectId: string | undefined) {
  const key = projectId ? `exegol-task-file-${projectId}` : null;
  const [filePath, setFilePathState] = useState<string | null>(() => {
    if (!key) return null;
    return localStorage.getItem(key);
  });

  const setFilePath = useCallback(
    (path: string | null) => {
      setFilePathState(path);
      if (key) {
        if (path) localStorage.setItem(key, path);
        else localStorage.removeItem(key);
      }
    },
    [key],
  );

  return [filePath, setFilePath] as const;
}
