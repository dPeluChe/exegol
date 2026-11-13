export const text = (value: unknown): string => (typeof value === "string" ? value : "");

/** Names as a person or an agent types them: case and outer spaces do not count */
export const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
