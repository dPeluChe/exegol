import { MODEL_ID_PATTERN, MODEL_SUGGESTIONS } from "@exegol/shared";
import { cn } from "@exegol/ui";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { trpcInvoke } from "../../lib/trpc-client";
import { INPUT_CLASS } from "./SpawnOptions";

const OTHER = "__other__";

/** One model dropdown, for the main model and every role: Default, suggested, the CLI's own list
 *  (agents.listModels), and "Other..." to type an id. `accepts` drops models the field refuses */
export function ModelSelect({
  id,
  providerId,
  label,
  value,
  onChange,
  suggestions,
  defaultLabel = "Default (the CLI's own setting)",
  accepts,
  invalid,
}: {
  id: string;
  providerId: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  suggestions?: string[];
  defaultLabel?: string;
  accepts?: (model: string) => boolean;
  invalid?: boolean;
}) {
  const { data: listed = [] } = useQuery({
    queryKey: ["cliModels", providerId],
    queryFn: () => trpcInvoke<string[]>("agents.listModels", { cliType: providerId }),
    staleTime: 10 * 60 * 1000,
  });
  const keep = (m: string) => !accepts || accepts(m);
  const suggested = (suggestions ?? MODEL_SUGGESTIONS[providerId] ?? []).filter(keep);
  const available = listed.filter((m) => !suggested.includes(m) && keep(m));
  const known = new Set([...suggested, ...available]);
  // A typed id stays in its own field; "Other..." opens it
  const [custom, setCustom] = useState(false);
  const typing = custom || (value.trim() !== "" && !known.has(value));
  const bad = invalid ?? (value.trim() !== "" && !MODEL_ID_PATTERN.test(value.trim()));
  return (
    <>
      <select
        id={id}
        value={typing ? OTHER : value}
        onChange={(e) => {
          const v = e.target.value;
          setCustom(v === OTHER);
          onChange(v === OTHER ? "" : v);
        }}
        className={cn(INPUT_CLASS, "cursor-pointer truncate")}
      >
        <option value="">{defaultLabel}</option>
        {suggested.length > 0 && (
          <optgroup label="Suggested">
            {suggested.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </optgroup>
        )}
        {available.length > 0 && (
          <optgroup label="Available to your account">
            {available.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </optgroup>
        )}
        <option value={OTHER}>Other (type an id)...</option>
      </select>
      {typing && (
        <input
          // biome-ignore lint/a11y/noAutofocus: opened by choosing "Other", typing is next
          autoFocus={custom}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={`${label} id, e.g. ${suggested[0] ?? available[0] ?? "model-name"}`}
          aria-label={`${label} id`}
          aria-invalid={bad}
          className={cn(INPUT_CLASS, bad && "border-red-500/60")}
        />
      )}
    </>
  );
}
