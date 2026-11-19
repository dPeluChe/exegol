export { sameName } from "@exegol/shared";

/** How a session is named to others: its name, else the start of its id */
export const sessionName = (s: { id: string; alias?: string | null }) =>
  s.alias || s.id.slice(0, 8);

export const text = (value: unknown): string => (typeof value === "string" ? value : "");
