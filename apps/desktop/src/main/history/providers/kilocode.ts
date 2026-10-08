import { resolveCommand } from "../../agents/spawn-env";
import type { LocalHistoryProvider, LocalSession } from "../types";
import { listViaCli } from "./opencode";

/** `kilo session list --format json`, the same listing as opencode's (Kilo Code 1.0 is a fork) */
export const kilocodeHistory: LocalHistoryProvider = {
  id: "kilocode",

  list(cwds: string[], since: number): Promise<LocalSession[]> {
    return listViaCli(resolveCommand("kilocode"), "kilocode", cwds, since);
  },
};
