import type { GitHubCi } from "@exegol/shared";
import { z } from "zod";

export const checkRollupSchema = z.array(
  z.object({
    __typename: z.string().optional(),
    name: z.string().nullish(),
    context: z.string().nullish(),
    conclusion: z.string().nullish(),
    state: z.string().nullish(),
    detailsUrl: z.string().nullish(),
    targetUrl: z.string().nullish(),
  }),
);
type CheckRollup = z.infer<typeof checkRollupSchema>;

// CheckRun conclusions and StatusContext states that mean "this needs a fix"
const FAILED = new Set([
  "FAILURE",
  "ERROR",
  "TIMED_OUT",
  "CANCELLED",
  "ACTION_REQUIRED",
  "STARTUP_FAILURE",
]);

const NOT_DONE = new Set(["", "PENDING", "EXPECTED"]);

// An unfinished CheckRun has conclusion "", so `||` falls through to the StatusContext's state
const statusOf = (c: CheckRollup[number]) => (c.conclusion || c.state || "").toUpperCase();

export function failingChecks(rollup: CheckRollup): { name: string; link: string | null }[] {
  return rollup
    .filter((c) => FAILED.has(statusOf(c)))
    .map((c) => ({
      name: c.name ?? c.context ?? "check",
      link: c.detailsUrl ?? c.targetUrl ?? null,
    }));
}

export function ciState(rollup: CheckRollup): GitHubCi {
  if (rollup.length === 0) return "none";
  const statuses = rollup.map(statusOf);
  if (statuses.some((s) => FAILED.has(s))) return "failing";
  return statuses.some((s) => NOT_DONE.has(s)) ? "pending" : "passing";
}
