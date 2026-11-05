import type { UsageModelRow, UsageReport, UsageTotals } from "@exegol/shared";
import { type ModelPrice, priceFor } from "./pricing";

/** One SQL group: project x CLI x provider x model x local day x cost source */
export interface UsageRow {
  projectId: string;
  projectName: string;
  cli: string;
  provider: string;
  model: string;
  date: string;
  costSource: string;
  /** Agent id or the CLI's session id; "" when neither is known */
  session: string;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  records: number;
}

interface Acc {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  records: number;
  toolCalls: number;
  pricedTokens: number;
  unpricedRecords: number;
  unpricedTokens: number;
}

const emptyAcc = (): Acc => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  cost: 0,
  records: 0,
  toolCalls: 0,
  pricedTokens: 0,
  unpricedRecords: 0,
  unpricedTokens: 0,
});

const rowTokens = (r: UsageRow) =>
  r.inputTokens + r.outputTokens + r.cacheReadTokens + r.cacheWriteTokens;

function add(acc: Acc, row: UsageRow, unpriced: boolean): void {
  acc.input += row.inputTokens;
  acc.output += row.outputTokens;
  acc.cacheRead += row.cacheReadTokens;
  acc.cacheWrite += row.cacheWriteTokens;
  acc.records += row.records;
  acc.toolCalls += row.toolCalls;
  if (unpriced) {
    acc.unpricedRecords += row.records;
    acc.unpricedTokens += rowTokens(row);
  } else {
    acc.cost += row.costUsd;
    acc.pricedTokens += rowTokens(row);
  }
}

function totalsOf(acc: Acc): UsageTotals {
  const promptTokens = acc.input + acc.cacheRead + acc.cacheWrite;
  return {
    inputTokens: acc.input,
    outputTokens: acc.output,
    cacheReadTokens: acc.cacheRead,
    cacheWriteTokens: acc.cacheWrite,
    totalTokens: promptTokens + acc.output,
    costUsd: acc.records > 0 && acc.unpricedRecords === acc.records ? null : acc.cost,
    records: acc.records,
    toolCalls: acc.toolCalls,
    cacheHitRate: promptTokens > 0 ? acc.cacheRead / promptTokens : null,
    unpriced: { records: acc.unpricedRecords, tokens: acc.unpricedTokens },
  };
}

class Groups<K extends string> {
  private readonly map = new Map<string, { key: Record<K, string>; acc: Acc }>();
  add(key: Record<K, string>, row: UsageRow, unpriced: boolean): void {
    const id = Object.values(key).join("\0");
    let group = this.map.get(id);
    if (!group) {
      group = { key, acc: emptyAcc() };
      this.map.set(id, group);
    }
    add(group.acc, row, unpriced);
  }
  values() {
    return [...this.map.values()];
  }
}

const MAX_SESSIONS = 30;

/**
 * A row stored as priced whose model the table no longer prices (or never did: rows written
 * before the unpriced rule were billed at the Sonnet default) counts as unpriced too.
 */
export const isUnpriced = (costSource: string, model: string, price = priceFor) =>
  costSource === "unpriced" || (costSource === "priced" && !price(model));

const byTokensDesc = (a: UsageTotals, b: UsageTotals) => b.totalTokens - a.totalTokens;

export function aggregateUsage(
  rows: UsageRow[],
  range: { since: number; until: number },
): Omit<UsageReport, "lastImportAt"> {
  const prices = new Map<string, ModelPrice | null>();
  const price = (model: string) => {
    if (!prices.has(model)) prices.set(model, priceFor(model));
    return prices.get(model) ?? null;
  };
  const total = emptyAcc();
  const projects = new Groups<"projectId" | "projectName">();
  const clis = new Groups<"cli">();
  const providers = new Groups<"provider">();
  const models = new Groups<"model" | "provider">();
  const days = new Groups<"date">();
  const sessions = new Groups<"session" | "cli" | "projectName">();
  for (const row of rows) {
    const unpriced = isUnpriced(row.costSource, row.model, price);
    add(total, row, unpriced);
    projects.add({ projectId: row.projectId, projectName: row.projectName }, row, unpriced);
    clis.add({ cli: row.cli }, row, unpriced);
    providers.add({ provider: row.provider }, row, unpriced);
    models.add({ model: row.model, provider: row.provider }, row, unpriced);
    days.add({ date: row.date }, row, unpriced);
    if (row.session) {
      const key = { session: row.session, cli: row.cli, projectName: row.projectName };
      sessions.add(key, row, unpriced);
    }
  }
  const list = <K extends string>(groups: Groups<K>) =>
    groups
      .values()
      .map(({ key, acc }) => ({ ...key, ...totalsOf(acc) }))
      .sort(byTokensDesc);
  const byModel: UsageModelRow[] = models
    .values()
    .map(({ key, acc }) => ({
      ...key,
      ...totalsOf(acc),
      listPrice: price(key.model),
      costPerMTok: acc.pricedTokens > 0 ? (acc.cost / acc.pricedTokens) * 1_000_000 : null,
    }))
    .sort(byTokensDesc);
  return {
    since: range.since,
    until: range.until,
    totals: totalsOf(total),
    byProject: list(projects),
    byCli: list(clis),
    byProvider: list(providers),
    byModel,
    byDay: list(days).sort((a, b) => a.date.localeCompare(b.date)),
    bySession: list(sessions).slice(0, MAX_SESSIONS),
  };
}
