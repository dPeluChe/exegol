import type { NotesListing, NotesPlace } from "@exegol/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { trpcInvoke } from "../lib/trpc-client";
import { useMountEffect } from "./use-mount-effect";

/** One listener app-wide: agent writes and the person's push `notes:changed` */
export function useNotesSync() {
  const queryClient = useQueryClient();
  useMountEffect(() =>
    window.api.onNotesChanged(() => {
      void queryClient.invalidateQueries({ queryKey: ["notes"] });
    }),
  );
}

const placeKey = (p: NotesPlace) =>
  p.scope === "project" ? p.projectId : p.scope === "colab" ? p.colabId : "personal";

export function useNotes(place: NotesPlace, retired: boolean) {
  return useQuery({
    queryKey: ["notes", place.scope, placeKey(place), retired],
    queryFn: () => trpcInvoke<NotesListing>("notes.list", { place, retired }),
  });
}
