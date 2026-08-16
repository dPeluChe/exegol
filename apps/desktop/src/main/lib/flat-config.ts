/**
 * The `key: value` subset of YAML that Exegol's repo-level config files use.
 *
 * Three copies of this loop had grown (lifecycle.yaml, project hooks, run
 * actions) and they had already drifted: only one stripped trailing comments,
 * so `seed: bun run seed # dev only` executed the comment.
 *
 * Deliberately not a YAML library: these files are a handful of lines, and a
 * parser small enough to read is one whose failure modes are all visible.
 */
export function parseFlatConfig(content: string): Array<[key: string, value: string]> {
  const entries: Array<[string, string]> = [];

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const match = trimmed.match(/^([A-Za-z0-9_][A-Za-z0-9 _-]*?)\s*:\s*(.+)$/);
    const key = match?.[1]?.trim();
    let value = match?.[2]?.trim();
    if (!key || !value) continue;

    // A quoted value is taken verbatim — a `#` inside it is part of the command.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    } else {
      const commentIdx = value.indexOf(" #");
      if (commentIdx !== -1) value = value.slice(0, commentIdx).trim();
    }

    if (value) entries.push([key, value]);
  }

  return entries;
}
