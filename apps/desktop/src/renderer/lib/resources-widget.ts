import type { WidgetMode } from "./status-bar-widgets";

type Metrics = Pick<SystemMetricsEvent, "cpu" | "memory" | "usage">;

/** Bytes as GB with one decimal, without a trailing ".0" ("22.4", "32") */
export function formatGb(bytes: number): string {
  const gb = (bytes / 1024 ** 3).toFixed(1);
  return gb.endsWith(".0") ? gb.slice(0, -2) : gb;
}

/** The text after the "RAM" label: "70%" or "22.4/32 GB" */
export function ramText(memory: Metrics["memory"], mode: WidgetMode): string {
  return mode === "values"
    ? `${formatGb(memory.used)}/${formatGb(memory.total)} GB`
    : `${Math.round(memory.usagePercent)}%`;
}

export function resourcesTooltip(m: Metrics, machine: string): string {
  const lines = [
    `${machine}: CPU ${Math.round(m.cpu.usage)}% · RAM ${formatGb(m.memory.used)} of ${formatGb(m.memory.total)} GB used (${Math.round(m.memory.usagePercent)}%)`,
  ];
  if (m.usage) {
    const cpu = Math.round(m.usage.exegolCpu + m.usage.agentsCpu);
    const ram = formatGb(m.usage.exegolMemory + m.usage.agentsMemory);
    lines.push(`Exegol and its agents: CPU ${cpu}% · RAM ${ram} GB`);
  }
  lines.push(
    "RAM counts active, wired and compressed memory (macOS). High RAM alone is fine; high RAM with swap is what slows the machine.",
  );
  return lines.join("\n");
}
