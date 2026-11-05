/**
 * A CLI's own report of what it is doing, read from its raw output: `progress` (OSC 9;4, ConEmu /
 * Ghostty, state "0".."4"), `status` (OSC 7501 Program Status root record) or `query` (OSC 7501 ; ?).
 * JS mirror of the Rust `OscStatusScanner` (core-rust/src/processing/osc_status.rs); parity is
 * enforced by the `termReports` vectors in packages/core-rust/test-vectors/parser-vectors.json.
 */
export type TermReport = {
  kind: "progress" | "status" | "query";
  state: string;
  /** What a blocked program waits for: permission, question or auth */
  detail: string | null;
};

const MAX_BODY_CHARS = 256;
const STATUS_STATES = new Set(["idle", "working", "blocked", "done", "error", "clear"]);
const BLOCKED_KINDS = new Set(["permission", "question", "auth"]);
const PROGRESS_STATES = new Set(["0", "1", "2", "3", "4"]);

type ScanState = "ground" | "esc" | "osc" | "oscEsc";

export class OscStatusScanner {
  private state: ScanState = "ground";
  private body = "";
  private bodyChars = 0;

  scan(data: string): TermReport[] {
    const out: TermReport[] = [];
    for (let i = 0; i < data.length; i++) {
      if (this.state === "ground") {
        // Hot path: most output has no OSC, so jump straight to the next ESC
        i = data.indexOf("\x1b", i);
        if (i === -1) break;
        this.state = "esc";
        continue;
      }
      const ch = data[i];
      switch (this.state) {
        case "esc":
          if (ch === "]") this.startOsc();
          else if (ch !== "\x1b") this.state = "ground";
          break;
        case "osc":
          if (ch === "\x07") this.finish(out);
          else if (ch === "\x1b") this.state = "oscEsc";
          else if (this.bodyChars < MAX_BODY_CHARS) {
            // The cap counts code points, as Rust's chars() does: keep a surrogate pair whole
            const pair = (data.codePointAt(i) ?? 0) > 0xffff;
            this.body += pair ? data.slice(i, i + 2) : ch;
            if (pair) i++;
            this.bodyChars++;
          }
          break;
        case "oscEsc":
          if (ch === "\\") this.finish(out);
          else if (ch === "]") this.startOsc();
          else this.state = ch === "\x1b" ? "esc" : "ground";
          break;
      }
    }
    return out;
  }

  private startOsc(): void {
    this.state = "osc";
    this.body = "";
    this.bodyChars = 0;
  }

  private finish(out: TermReport[]): void {
    const report = parseBody(this.body);
    if (report) out.push(report);
    this.state = "ground";
    this.body = "";
  }
}

function parseBody(body: string): TermReport | null {
  if (body === "9;4" || body.startsWith("9;4;")) {
    const state = body.slice(4).split(";")[0] || "0";
    return PROGRESS_STATES.has(state) ? { kind: "progress", state, detail: null } : null;
  }
  if (!body.startsWith("7501;")) return null;
  const rest = body.slice(5);
  if (rest.startsWith("?")) return { kind: "query", state: "", detail: null };
  let state: string | undefined;
  let kind: string | undefined;
  for (const pair of rest.split(":")) {
    const eq = pair.indexOf("=");
    const key = eq === -1 ? pair : pair.slice(0, eq);
    const value = eq === -1 ? "" : pair.slice(eq + 1);
    // A record with an id is one part of the work, not the program's status
    if (key === "id" && value) return null;
    if (key === "state") state = value;
    else if (key === "kind") kind = value;
  }
  if (!state || !STATUS_STATES.has(state)) return null;
  const detail = state === "blocked" && kind && BLOCKED_KINDS.has(kind) ? kind : null;
  return { kind: "status", state, detail };
}
