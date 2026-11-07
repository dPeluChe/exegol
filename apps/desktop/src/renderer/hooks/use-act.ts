import { useState } from "react";
import { trpcMutate } from "../lib/trpc-client";
import { toastError } from "../stores/toasts";

/** A mutation from a button: busy while it runs, a toast when it fails. Null on failure, since
 *  many mutations return nothing */
export function useAct(failed: string) {
  const [busy, setBusy] = useState(false);
  const act = async <T>(path: string, input: object): Promise<{ value: T } | null> => {
    setBusy(true);
    try {
      return { value: await trpcMutate<T>(path, input) };
    } catch (err) {
      toastError(failed)(err);
      return null;
    } finally {
      setBusy(false);
    }
  };
  return { busy, act };
}
