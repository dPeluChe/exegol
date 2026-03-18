import { useCallback, useEffect, useMemo, useState } from "react";

// ─── Types ──────────────────────────────────────────────────────────────────

type Frequency = "every-minutes" | "hourly" | "daily" | "weekly" | "monthly" | "custom";

interface CronBuilderProps {
  value: string;
  onChange: (cron: string) => void;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const MINUTE_INTERVALS = [5, 10, 15, 30] as const;
const MINUTES = Array.from({ length: 60 }, (_, i) => i);
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MONTH_DAYS = Array.from({ length: 28 }, (_, i) => i + 1);

const DAYS_OF_WEEK = [
  { label: "Sunday", value: 0 },
  { label: "Monday", value: 1 },
  { label: "Tuesday", value: 2 },
  { label: "Wednesday", value: 3 },
  { label: "Thursday", value: 4 },
  { label: "Friday", value: 5 },
  { label: "Saturday", value: 6 },
] as const;

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatHour(h: number): string {
  const period = h >= 12 ? "PM" : "AM";
  const display = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${display} ${period}`;
}

function padTwo(n: number): string {
  return String(n).padStart(2, "0");
}

/** Try to detect the frequency type from an existing cron expression. */
function detectFrequency(cron: string): {
  frequency: Frequency;
  interval: number;
  minute: number;
  hour: number;
  dayOfWeek: number;
  dayOfMonth: number;
} {
  const defaults = { interval: 15, minute: 0, hour: 9, dayOfWeek: 1, dayOfMonth: 1 };
  const parts = cron.trim().split(/\s+/);

  if (parts.length !== 5) {
    return { frequency: "custom", ...defaults };
  }

  // Safe: we've confirmed exactly 5 parts above
  const minPart = parts[0] as string;
  const hourPart = parts[1] as string;
  const domPart = parts[2] as string;
  const dowPart = parts[4] as string;

  // every-minutes: */X * * * *
  const everyMinMatch = minPart.match(/^\*\/(\d+)$/);
  if (everyMinMatch?.[1] && hourPart === "*" && domPart === "*" && dowPart === "*") {
    const interval = Number.parseInt(everyMinMatch[1], 10);
    if ((MINUTE_INTERVALS as readonly number[]).includes(interval)) {
      return { frequency: "every-minutes", ...defaults, interval };
    }
  }

  // hourly: M * * * *
  if (/^\d+$/.test(minPart) && hourPart === "*" && domPart === "*" && dowPart === "*") {
    return { frequency: "hourly", ...defaults, minute: Number.parseInt(minPart, 10) };
  }

  // weekly: M H * * D
  if (/^\d+$/.test(minPart) && /^\d+$/.test(hourPart) && domPart === "*" && /^\d+$/.test(dowPart)) {
    return {
      frequency: "weekly",
      ...defaults,
      minute: Number.parseInt(minPart, 10),
      hour: Number.parseInt(hourPart, 10),
      dayOfWeek: Number.parseInt(dowPart, 10),
    };
  }

  // monthly: M H D * *
  if (/^\d+$/.test(minPart) && /^\d+$/.test(hourPart) && /^\d+$/.test(domPart) && dowPart === "*") {
    return {
      frequency: "monthly",
      ...defaults,
      minute: Number.parseInt(minPart, 10),
      hour: Number.parseInt(hourPart, 10),
      dayOfMonth: Number.parseInt(domPart, 10),
    };
  }

  // daily: M H * * *
  if (/^\d+$/.test(minPart) && /^\d+$/.test(hourPart) && domPart === "*" && dowPart === "*") {
    return {
      frequency: "daily",
      ...defaults,
      minute: Number.parseInt(minPart, 10),
      hour: Number.parseInt(hourPart, 10),
    };
  }

  return { frequency: "custom", ...defaults };
}

// ─── Shared select styling ──────────────────────────────────────────────────

const selectClass =
  "rounded-md border border-border bg-bg-secondary px-2 py-1 text-xs text-text-primary focus:border-accent focus:outline-none";

const inputClass =
  "w-full rounded-md border border-border bg-bg-secondary px-3 py-2 text-xs text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none font-mono";

// ─── Component ──────────────────────────────────────────────────────────────

export function CronBuilder({ value, onChange }: CronBuilderProps) {
  const detected = useMemo(() => detectFrequency(value), [value]);

  const [frequency, setFrequency] = useState<Frequency>(detected.frequency);
  const [interval, setInterval] = useState(detected.interval);
  const [minute, setMinute] = useState(detected.minute);
  const [hour, setHour] = useState(detected.hour);
  const [dayOfWeek, setDayOfWeek] = useState(detected.dayOfWeek);
  const [dayOfMonth, setDayOfMonth] = useState(detected.dayOfMonth);
  const [customCron, setCustomCron] = useState(frequency === "custom" ? value : "");

  // Build the cron expression from the current state
  const buildCron = useCallback((): string => {
    switch (frequency) {
      case "every-minutes":
        return `*/${interval} * * * *`;
      case "hourly":
        return `${minute} * * * *`;
      case "daily":
        return `${minute} ${hour} * * *`;
      case "weekly":
        return `${minute} ${hour} * * ${dayOfWeek}`;
      case "monthly":
        return `${minute} ${hour} ${dayOfMonth} * *`;
      case "custom":
        return customCron;
    }
  }, [frequency, interval, minute, hour, dayOfWeek, dayOfMonth, customCron]);

  // Build human-readable preview
  const preview = useMemo((): string => {
    switch (frequency) {
      case "every-minutes":
        return `Every ${interval} minutes`;
      case "hourly":
        return `Every hour at minute ${padTwo(minute)}`;
      case "daily":
        return `Daily at ${formatHour(hour)}:${padTwo(minute)}`;
      case "weekly": {
        const dayName = DAYS_OF_WEEK.find((d) => d.value === dayOfWeek)?.label ?? "Unknown";
        return `Every ${dayName} at ${formatHour(hour)}:${padTwo(minute)}`;
      }
      case "monthly":
        return `Monthly on day ${dayOfMonth} at ${formatHour(hour)}:${padTwo(minute)}`;
      case "custom":
        return customCron || "Enter a cron expression";
    }
  }, [frequency, interval, minute, hour, dayOfWeek, dayOfMonth, customCron]);

  // Emit changes whenever the built expression changes
  useEffect(() => {
    const cron = buildCron();
    if (cron && cron !== value) {
      onChange(cron);
    }
  }, [buildCron, onChange, value]);

  // When frequency changes away from custom, reset custom; when switching to custom, seed it
  const handleFrequencyChange = (newFreq: Frequency) => {
    if (newFreq === "custom") {
      setCustomCron(buildCron());
    }
    setFrequency(newFreq);
  };

  return (
    <div className="space-y-3">
      <div>
        <div className="mb-1 text-xs text-text-muted">Schedule</div>

        {/* Frequency selector */}
        <select
          value={frequency}
          onChange={(e) => handleFrequencyChange(e.target.value as Frequency)}
          className={`w-full ${selectClass}`}
        >
          <option value="every-minutes">Every X minutes</option>
          <option value="hourly">Hourly</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
          <option value="custom">Custom (advanced)</option>
        </select>
      </div>

      {/* Frequency-specific selectors */}
      <div className="rounded-md border border-border bg-bg-tertiary p-3">
        {frequency === "every-minutes" && (
          <div className="flex items-center gap-2 text-xs text-text-primary">
            <span>Every</span>
            <select
              value={interval}
              onChange={(e) => setInterval(Number.parseInt(e.target.value, 10))}
              className={selectClass}
            >
              {MINUTE_INTERVALS.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
            <span>minutes</span>
          </div>
        )}

        {frequency === "hourly" && (
          <div className="flex items-center gap-2 text-xs text-text-primary">
            <span>At minute</span>
            <select
              value={minute}
              onChange={(e) => setMinute(Number.parseInt(e.target.value, 10))}
              className={selectClass}
            >
              {MINUTES.map((v) => (
                <option key={v} value={v}>
                  {padTwo(v)}
                </option>
              ))}
            </select>
          </div>
        )}

        {frequency === "daily" && (
          <div className="flex items-center gap-2 text-xs text-text-primary">
            <span>At</span>
            <select
              value={hour}
              onChange={(e) => setHour(Number.parseInt(e.target.value, 10))}
              className={selectClass}
            >
              {HOURS.map((v) => (
                <option key={v} value={v}>
                  {formatHour(v)}
                </option>
              ))}
            </select>
            <span>:</span>
            <select
              value={minute}
              onChange={(e) => setMinute(Number.parseInt(e.target.value, 10))}
              className={selectClass}
            >
              {MINUTES.map((v) => (
                <option key={v} value={v}>
                  {padTwo(v)}
                </option>
              ))}
            </select>
          </div>
        )}

        {frequency === "weekly" && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-text-primary">
            <span>On</span>
            <select
              value={dayOfWeek}
              onChange={(e) => setDayOfWeek(Number.parseInt(e.target.value, 10))}
              className={selectClass}
            >
              {DAYS_OF_WEEK.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
            <span>at</span>
            <select
              value={hour}
              onChange={(e) => setHour(Number.parseInt(e.target.value, 10))}
              className={selectClass}
            >
              {HOURS.map((v) => (
                <option key={v} value={v}>
                  {formatHour(v)}
                </option>
              ))}
            </select>
            <span>:</span>
            <select
              value={minute}
              onChange={(e) => setMinute(Number.parseInt(e.target.value, 10))}
              className={selectClass}
            >
              {MINUTES.map((v) => (
                <option key={v} value={v}>
                  {padTwo(v)}
                </option>
              ))}
            </select>
          </div>
        )}

        {frequency === "monthly" && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-text-primary">
            <span>On day</span>
            <select
              value={dayOfMonth}
              onChange={(e) => setDayOfMonth(Number.parseInt(e.target.value, 10))}
              className={selectClass}
            >
              {MONTH_DAYS.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
            <span>at</span>
            <select
              value={hour}
              onChange={(e) => setHour(Number.parseInt(e.target.value, 10))}
              className={selectClass}
            >
              {HOURS.map((v) => (
                <option key={v} value={v}>
                  {formatHour(v)}
                </option>
              ))}
            </select>
            <span>:</span>
            <select
              value={minute}
              onChange={(e) => setMinute(Number.parseInt(e.target.value, 10))}
              className={selectClass}
            >
              {MINUTES.map((v) => (
                <option key={v} value={v}>
                  {padTwo(v)}
                </option>
              ))}
            </select>
          </div>
        )}

        {frequency === "custom" && (
          <div>
            <input
              value={customCron}
              onChange={(e) => setCustomCron(e.target.value)}
              placeholder="* * * * *"
              className={inputClass}
            />
            <p className="mt-1 text-[10px] text-text-muted">
              Format: minute hour day-of-month month day-of-week
            </p>
          </div>
        )}

        {/* Preview */}
        <div className="mt-3 border-t border-border pt-2">
          <p className="text-xs text-text-secondary">{preview}</p>
          <p className="mt-0.5 font-mono text-[10px] text-text-muted">{buildCron()}</p>
        </div>
      </div>
    </div>
  );
}
