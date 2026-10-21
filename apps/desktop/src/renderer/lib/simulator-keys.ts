import { SIM_KEYCODES, SIM_TYPE_MAX, type SimKey } from "@exegol/shared";

export type SimInput = { text: string } | { key: SimKey };

const isSimKey = (key: string): key is SimKey => Object.hasOwn(SIM_KEYCODES, key);

/** Printable US keys `axe type` can send; anything else is dropped */
export function typeable(key: string): boolean {
  return key.length === 1 && key >= " " && key <= "~";
}

/** A keydown to one input. Option stays: it types @ # [ ] { } \ | on non-US layouts */
export function keyInput(e: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}): SimInput | null {
  if (e.metaKey || e.ctrlKey) return null;
  if (isSimKey(e.key)) return e.altKey ? null : { key: e.key };
  return typeable(e.key) ? { text: e.key } : null;
}

/** Text to `axe type` calls of at most SIM_TYPE_MAX, line breaks and tabs as their keys */
export function textInputs(text: string, max = SIM_TYPE_MAX): SimInput[] {
  const out: SimInput[] = [];
  let run = "";
  const flush = () => {
    for (let i = 0; i < run.length; i += max) out.push({ text: run.slice(i, i + max) });
    run = "";
  };
  for (const ch of text.replace(/\r\n?/g, "\n")) {
    if (ch === "\n" || ch === "\t") {
      flush();
      out.push({ key: ch === "\n" ? "Enter" : "Tab" });
    } else if (typeable(ch)) run += ch;
  }
  flush();
  return out;
}
