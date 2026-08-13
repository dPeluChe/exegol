import { LIVE_STATUSES } from "@exegol/shared";
import type Database from "libsql";

/**
 * T160/T167: every session gets a unique short codename at birth.
 *
 * Why not "opencode-2": the numbering desynchronizes the moment agent 1 exits
 * (is the next one 2 again, or 3?), and two panes reading "opencode" is exactly
 * how a message ends up at the wrong agent. Why one word and not
 * "crimson-jupiter": the NAME is what an agent types into agent_send, so short
 * and distinct beats decorative.
 *
 * The provider is still shown next to it in the UI, so "vega · opencode" reads
 * naturally while "vega" stays the address.
 */
const NAME_POOL = [
  // celestial
  "vega",
  "atlas",
  "orion",
  "lyra",
  "rigel",
  "polaris",
  "altair",
  "sirius",
  "carina",
  "draco",
  "mira",
  "nova",
  "pavo",
  "lupus",
  "cygnus",
  "corvus",
  // mythic
  "iris",
  "hermes",
  "juno",
  "helios",
  "selene",
  "nyx",
  "eos",
  "hera",
  "argo",
  "tethys",
  "rhea",
  "hyperion",
  "phoenix",
  "chimera",
  "triton",
  "kairos",
  // stones & elements
  "onyx",
  "jade",
  "amber",
  "quartz",
  "basalt",
  "cobalt",
  "indigo",
  "cinder",
  "flint",
  "slate",
  "ember",
  "topaz",
  "opal",
  "argon",
  "xenon",
  "krypton",
  // fauna
  "falcon",
  "otter",
  "lynx",
  "heron",
  "ibis",
  "puma",
  "raven",
  "koi",
  "marlin",
  "osprey",
  "tapir",
  "vervet",
  "wombat",
  "civet",
  "gecko",
  "shrike",
] as const;

/**
 * Pick a codename no LIVE agent is using. Uniqueness is fleet-wide, not
 * per-project: `agents_list` and `agent_send` both resolve across projects, so
 * a second "juno" in another repo would be exactly the ambiguity this prevents.
 */
export function pickAgentCodename(db: Database.Database): string {
  const statuses = [...LIVE_STATUSES];
  let taken: Set<string>;
  try {
    const rows = db
      .prepare(
        `SELECT LOWER(alias) AS alias FROM agents
         WHERE alias IS NOT NULL AND status IN (${statuses.map(() => "?").join(",")})`,
      )
      .all(...statuses) as Array<{ alias: string }>;
    taken = new Set(rows.map((r) => r.alias));
  } catch {
    taken = new Set();
  }

  const free = NAME_POOL.filter((n) => !taken.has(n));
  if (free.length > 0) {
    // Rotate rather than always taking the first, so consecutive spawns don't
    // read as a sequence ("vega, atlas, orion" looks like an ordering).
    return free[Math.floor(Math.random() * free.length)] as string;
  }
  // Pool exhausted (60+ live agents): fall back to a numbered variant.
  for (let n = 2; ; n++) {
    const candidate = `${NAME_POOL[n % NAME_POOL.length]}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}
