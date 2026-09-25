import { ChevronDown, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";

/** A 13-digit number in this range is almost always an epoch-ms timestamp */
const MS_2000 = 946_684_800_000;
const MS_2100 = 4_102_444_800_000;

function Value({ value }: { value: unknown }) {
  if (value === null) return <span className="text-purple-400">null</span>;
  if (typeof value === "boolean") return <span className="text-purple-400">{String(value)}</span>;
  if (typeof value === "number") {
    const isMs = Number.isInteger(value) && value >= MS_2000 && value < MS_2100;
    return (
      <span className="text-sky-400">
        {value}
        {isMs && (
          <span className="ml-1.5 rounded bg-white/10 px-1 text-[10px] text-text-muted">
            {new Date(value).toISOString()}
          </span>
        )}
      </span>
    );
  }
  const text = String(value);
  return (
    <span
      className="whitespace-pre-wrap break-words text-emerald-400"
      title={text.length > 300 ? text : undefined}
    >
      "{text.length > 2000 ? `${text.slice(0, 2000)}…` : text}"
    </span>
  );
}

/** Children rendered per step: a 50k-line JSONL opened all at once froze the UI */
const PAGE = 200;

function Node({ name, value, depth }: { name: string | null; value: unknown; depth: number }) {
  const isArray = Array.isArray(value);
  const isObject = value !== null && typeof value === "object";
  const size = isObject ? Object.keys(value as object).length : 0;
  const [open, setOpen] = useState(depth === 0 || (depth < 2 && size <= PAGE));
  const [limit, setLimit] = useState(PAGE);
  const label = name !== null && <span className="text-text-secondary">{name}</span>;

  if (!isObject) {
    return (
      <div className="flex gap-1.5 py-px" style={{ paddingLeft: depth * 14 + 14 }}>
        {label}
        {label && <span className="text-text-muted">:</span>}
        <Value value={value} />
      </div>
    );
  }

  const entries = isArray
    ? (value as unknown[]).map((v, i) => [String(i), v] as const)
    : Object.entries(value as Record<string, unknown>);
  const count = entries.length;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 py-px text-left hover:bg-white/5"
        style={{ paddingLeft: depth * 14 }}
      >
        {open ? (
          <ChevronDown className="h-3 w-3 text-text-muted" />
        ) : (
          <ChevronRight className="h-3 w-3 text-text-muted" />
        )}
        {label ?? <span className="text-text-muted">{isArray ? "array" : "object"}</span>}
        <span className="text-text-muted">{isArray ? `[${count}]` : `{${count}}`}</span>
      </button>
      {open &&
        entries
          .slice(0, limit)
          .map(([k, v]) => <Node key={k} name={k} value={v} depth={depth + 1} />)}
      {open && count > limit && (
        <button
          type="button"
          onClick={() => setLimit((l) => l + PAGE)}
          className="py-px text-[11px] text-accent hover:underline"
          style={{ paddingLeft: (depth + 1) * 14 + 14 }}
        >
          Show {Math.min(PAGE, count - limit)} more of {count - limit}
        </button>
      )}
    </div>
  );
}

/**
 * JSON (or JSONL, one value per line) as a collapsible tree: first two levels
 * open, strings/numbers/booleans colored, epoch-ms numbers dated.
 */
export function JsonTree({ content, lines }: { content: string; lines: boolean }) {
  const parsed = useMemo(() => {
    try {
      const value = lines
        ? content
            .split("\n")
            .filter((l) => l.trim())
            .map((l) => JSON.parse(l))
        : JSON.parse(content);
      return { ok: true as const, value };
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
    }
  }, [content, lines]);

  if (!parsed.ok) {
    return <p className="p-3 text-xs text-red-400">Not valid JSON: {parsed.error}</p>;
  }
  return (
    <div className="h-full overflow-auto p-2 font-mono text-[12px] leading-5">
      <Node name={null} value={parsed.value} depth={0} />
    </div>
  );
}
