/**
 * A command's binary and flags, without prompts, paths or values: what a log
 * line needs to debug a spawn, and nothing a user would not want in a report.
 */
export function commandShape(cmd: string): string {
  const [bin = "", ...rest] = cmd.trim().split(/\s+/);
  const flags = rest.filter((t) => /^--?[A-Za-z][\w-]*$/.test(t));
  const shape = [bin.split("/").pop(), ...flags];
  if (rest.length > flags.length) shape.push("<args>");
  return shape.join(" ");
}
