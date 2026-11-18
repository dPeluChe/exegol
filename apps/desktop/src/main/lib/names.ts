export { sameName } from "@exegol/shared";

export const text = (value: unknown): string => (typeof value === "string" ? value : "");
