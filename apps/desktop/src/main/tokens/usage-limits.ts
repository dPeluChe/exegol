import type { UsageLimit } from "@exegol/shared";
import { limitThreshold } from "@exegol/shared";
import type Database from "libsql";
import { listCliSpendRows } from "../db/queries";
import { getJsonSetting, setJsonSetting } from "../db/queries/settings";
import { getNotificationBus } from "../notifications/bus";
import { formatUsage } from "./budget-check";
import { isUnpriced } from "./usage-aggregation";

const LIMITS_KEY = "usage_limits";
const ALERTS_KEY = "usage_limit_alerts";

type Limits = Record<string, number>;
/** The highest threshold announced per CLI, and in which month */
type Alerts = Record<string, { month: string; threshold: 80 | 100 }>;

export function monthWindow(now: Date): { since: number; key: string } {
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return { since: Math.floor(start.getTime() / 1000), key: `${now.getFullYear()}-${month}` };
}

/** Limits past 80 or 100% not announced yet this month */
export function limitCrossings(
  spent: Record<string, number>,
  limits: Limits,
  alerts: Alerts,
  month: string,
) {
  return Object.entries(limits).flatMap(([cli, limitUsd]) => {
    const spentUsd = spent[cli] ?? 0;
    const threshold = limitThreshold((spentUsd / limitUsd) * 100);
    const last = alerts[cli];
    if (!threshold || (last?.month === month && last.threshold >= threshold)) return [];
    return [{ cli, threshold, spentUsd, limitUsd }];
  });
}

function monthSpend(db: Database.Database): Record<string, number> {
  const now = new Date();
  const until = Math.floor(now.getTime() / 1000) + 1;
  const spent: Record<string, number> = {};
  for (const r of listCliSpendRows(db, monthWindow(now).since, until)) {
    spent[r.cli] = (spent[r.cli] ?? 0) + (isUnpriced(r.costSource, r.model) ? 0 : r.costUsd);
  }
  return spent;
}

const getLimits = (db: Database.Database) => getJsonSetting<Limits>(db, LIMITS_KEY, {});

export function usageLimitRows(db: Database.Database): UsageLimit[] {
  const limits = getLimits(db);
  const spent = monthSpend(db);
  return [...new Set([...Object.keys(spent), ...Object.keys(limits)])]
    .map((cli) => ({ cli, limitUsd: limits[cli] ?? null, spentUsd: spent[cli] ?? 0 }))
    .sort((a, b) => b.spentUsd - a.spentUsd);
}

export function setUsageLimit(db: Database.Database, cli: string, limitUsd: number | null): void {
  const { [cli]: _old, ...rest } = getLimits(db);
  setJsonSetting(db, LIMITS_KEY, limitUsd === null ? rest : { ...rest, [cli]: limitUsd });
}

export function checkUsageLimits(db: Database.Database): void {
  const limits = getLimits(db);
  if (Object.keys(limits).length === 0) return;
  const { key: month } = monthWindow(new Date());
  const alerts = getJsonSetting<Alerts>(db, ALERTS_KEY, {});
  const crossings = limitCrossings(monthSpend(db), limits, alerts, month);
  if (crossings.length === 0) return;
  const fired = crossings.map((c) => [c.cli, { month, threshold: c.threshold }]);
  setJsonSetting(db, ALERTS_KEY, { ...alerts, ...Object.fromEntries(fired) });
  for (const c of crossings) {
    getNotificationBus().emit({
      type: "budget:warning",
      title:
        c.threshold === 100 ? `${c.cli}: monthly limit reached` : `${c.cli}: 80% of monthly limit`,
      body: `Used ${formatUsage(c.spentUsd, "dollars")} of ${formatUsage(c.limitUsd, "dollars")} this month`,
      at: Date.now(),
      meta: { threshold: c.threshold, cli: c.cli, current: c.spentUsd, limit: c.limitUsd },
    });
  }
}
