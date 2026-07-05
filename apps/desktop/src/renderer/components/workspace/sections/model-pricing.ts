import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getContext } from "tokenlens";
import { trpcInvoke, trpcMutate } from "../../../lib/trpc-client";

export type ModelPrice = { input: number; output: number };
export type ModelCatalog = Record<string, ModelPrice>;

export function useModelCatalog() {
  return useQuery({
    queryKey: ["modelCatalog"],
    queryFn: () => trpcInvoke<ModelCatalog>("settings.modelCatalog"),
    staleTime: 60_000,
  });
}

/** T147: editable provider price table (merges into the DB-backed catalog). */
export function useUpdateModelCatalog() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (updates: ModelCatalog) =>
      trpcMutate<ModelCatalog>("settings.updateModelCatalog", updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["modelCatalog"] });
    },
  });
}

export function getModelPrice(model: string, catalog: ModelCatalog | undefined): ModelPrice | null {
  if (!catalog) return null;
  if (catalog[model]) return catalog[model];
  for (const [key, val] of Object.entries(catalog)) {
    if (model.startsWith(key) || key.startsWith(model)) return val;
  }
  return null;
}

/**
 * Look up max context window for a model via tokenlens registry.
 * Returns combined/total token cap when available, falling back to maxInput.
 */
export function getModelMaxContext(model: string): number | null {
  try {
    const ctx = getContext({ modelId: model });
    return ctx.maxTotal ?? ctx.maxInput ?? null;
  } catch {
    return null;
  }
}
