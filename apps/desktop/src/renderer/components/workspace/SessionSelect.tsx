import { sameName } from "@exegol/shared";
import { useId } from "react";
import { useSessionTargets } from "../../hooks/use-session-targets";
import { sendLabel } from "../terminal/send-targets";

/** One of a project's open sessions by name, or any (null). A name with no open session stays
 *  listed as not open; nothing shows with no session and no name */
export function SessionSelect({
  projectId,
  value,
  onChange,
  any = "Any session",
  prefix = "",
  disabled,
  className,
  label,
}: {
  projectId: string;
  value: string | null;
  onChange: (session: string | null) => void;
  any?: string;
  prefix?: string;
  disabled?: boolean;
  className: string;
  /** Shown before the dropdown, with what picking does as its tooltip */
  label?: { text: string; title: string; className: string };
}) {
  const id = useId();
  const { targets, cliNames } = useSessionTargets(projectId);
  if (targets.length === 0 && !value) return null;
  const open = value ? targets.find((t) => sameName(t.name, value)) : undefined;
  const select = (
    <select
      id={id}
      value={open?.name ?? value ?? ""}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value || null)}
      aria-label="Session it is for"
      className={className}
    >
      <option value="">{any}</option>
      {targets.map((t) => (
        <option key={t.id} value={t.name}>
          {prefix}
          {sendLabel(t, cliNames[t.id])}
        </option>
      ))}
      {value && !open && <option value={value}>{value} (not open)</option>}
    </select>
  );
  if (!label) return select;
  return (
    <span className={label.className} title={label.title}>
      <label htmlFor={id}>{label.text}</label>
      {select}
    </span>
  );
}
