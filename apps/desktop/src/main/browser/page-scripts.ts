// Scripts run in the page's isolated world (its own globals, the page's DOM): refs survive between
// calls on the same document and page code cannot tamper with them.

const MAX_SNAPSHOT_ELEMENTS = 250;
const MAX_SNAPSHOT_TEXT = 8_000;
// The default snapshot: what is around the viewport, the cheap read an agent takes after each step
const VIEW_ELEMENTS = 120;
const VIEW_TEXT = 4_000;
/** Nodes one snapshot looks at; past this the walk stops and says so */
const MAX_WALK = 20_000;

interface RawElement {
  ref: string;
  role: string;
  name: string;
  tag: string;
  type?: string;
  value?: string;
  checked?: boolean;
  disabled?: boolean;
  href?: string;
}

/** The small read every action does before and after it: where the page is and what it asks */
export interface RawSignals {
  url: string;
  title: string;
  hasPasswordField: boolean;
  hasCaptcha: boolean;
  loggedIn: boolean;
  /** A password field (or one drawn as one) has the focus */
  focusSecret: boolean;
  /** DOM changes, input and scrolling since the last action; null on a document no action touched */
  mutations: number | null;
}

export interface RawSnapshot extends RawSignals {
  text: string;
  elements: RawElement[];
  /** The walk stopped at the element cap or the node cap */
  more: boolean;
  /** Elements left out for being far from the viewport */
  offscreen: number;
  /** The offset that continues the list, when it was cut */
  nextOffset: number | null;
  /** The whole page's text, of which `text` is a slice */
  textLength: number;
  /** Cross-origin iframes: nothing of them can be read */
  framesSkipped: number;
}

export interface SnapshotOptions {
  /** The whole page, not just around the viewport */
  full: boolean;
  /** Skip this many elements */
  offset: number;
  /** Start the text here */
  textOffset: number;
}

export function snapshotCaps(full: boolean) {
  return full
    ? { maxElements: MAX_SNAPSHOT_ELEMENTS, maxText: MAX_SNAPSHOT_TEXT }
    : { maxElements: VIEW_ELEMENTS, maxText: VIEW_TEXT };
}

/** e12.k3x: element 12 of the document k3x. A ref from a page the pane has left never resolves */
const REF_RE = /^e[1-9]\d{0,5}\.[a-z0-9]{3,8}$/;

export function parseRef(raw: unknown): string | null {
  return typeof raw === "string" && REF_RE.test(raw.trim()) ? raw.trim() : null;
}

/** Elements as one line each ("e12.k3x button "Save" [disabled]"): compact for the model */
function formatElement(e: RawElement): string {
  const parts = [e.ref, e.role];
  if (e.name) parts.push(JSON.stringify(e.name));
  if (e.type && e.type !== "text" && e.role === "textbox") parts.push(`type=${e.type}`);
  if (e.value !== undefined && e.value !== "") parts.push(`value=${JSON.stringify(e.value)}`);
  if (e.checked !== undefined) parts.push(e.checked ? "[checked]" : "[unchecked]");
  if (e.disabled) parts.push("[disabled]");
  if (e.href) parts.push(`-> ${e.href}`);
  return parts.join(" ");
}

export function formatSnapshot(
  raw: RawSnapshot,
  caps: { maxElements?: number; maxText?: number } = {},
): { title: string; text: string; elements: string[]; truncated: boolean } {
  const maxElements = caps.maxElements ?? MAX_SNAPSHOT_ELEMENTS;
  const maxText = caps.maxText ?? MAX_SNAPSHOT_TEXT;
  const text = raw.text.length > maxText ? `${raw.text.slice(0, maxText)}…` : raw.text;
  return {
    title: raw.title.slice(0, 300),
    text,
    elements: raw.elements.slice(0, maxElements).map(formatElement),
    truncated:
      raw.text.length > maxText ||
      raw.elements.length > maxElements ||
      raw.more ||
      raw.offscreen > 0,
  };
}

/** Throws unless the page is still on the host the caller checked: the check and what follows
 *  run in the same JS task, so a navigation in between cannot slip a foreign page in */
export const HOST_GUARD = (expectedHost: string) =>
  `if (location.host !== ${JSON.stringify(expectedHost)}) throw new Error("exegol:page_changed");`;

export const PAGE_COMMON = `
const refEl = (ref) => {
  const st = globalThis.__exegol;
  const el = st && ref.split(".")[1] === st.doc ? st.refs.get(ref)?.deref() : null;
  return el && el.isConnected ? el : null;
};
const vis = (el) => {
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return false;
  const s = getComputedStyle(el);
  return s.visibility !== "hidden" && s.display !== "none";
};
const isSecret = (el) => {
  if (!el || (el.tagName !== "INPUT" && el.tagName !== "TEXTAREA")) return false;
  if (el.type === "password" || /password/i.test(el.autocomplete || "") || /passw|pwd/i.test(el.name || el.id || "")) return true;
  const ts = getComputedStyle(el).webkitTextSecurity;
  return !!ts && ts !== "none";
};
const frameDoc = (f) => { try { return f.contentDocument; } catch { return null; } };
const docs = () => [document, ...[...document.querySelectorAll("iframe")].map(frameDoc).filter(Boolean)];
const deepActive = () => {
  let a = document.activeElement;
  for (;;) {
    if (a && a.shadowRoot && a.shadowRoot.activeElement) { a = a.shadowRoot.activeElement; continue; }
    const inner = a && a.tagName === "IFRAME" ? frameDoc(a) : null;
    if (!inner || !inner.activeElement) return a;
    a = inner.activeElement;
  }
};
const signals = () => ({
  url: location.href,
  title: document.title,
  hasPasswordField: docs().some((d) => [...d.querySelectorAll("input")].some((el) => isSecret(el) && vis(el))),
  hasCaptcha: docs().some((d) => !!d.querySelector('iframe[src*="recaptcha"],iframe[src*="hcaptcha"],iframe[src*="challenges.cloudflare.com"],.g-recaptcha,.h-captcha,.cf-turnstile')),
  loggedIn: !!document.querySelector('a[href*="logout" i],a[href*="signout" i],a[href*="sign_out" i],a[href*="log_out" i],form[action*="logout" i]') ||
    [...document.querySelectorAll('button,[role=button],[role=menuitem]')].slice(0, 300).some((el) => /^\\s*(log|sign)\\s?out\\s*$/i.test(el.textContent || "")),
  focusSecret: isSecret(deepActive()),
  mutations: readWatch(),
});
const stopWatch = (w) => { if (w.stop) w.stop(); w.stop = null; };
const readWatch = () => {
  const w = globalThis.__exegolWatch;
  if (!w) return null;
  stopWatch(w);
  return w.count;
};
// Only between an action and its read: a page the agent left pays nothing for it
const watchChanges = (withScroll) => {
  const w = globalThis.__exegolWatch || (globalThis.__exegolWatch = { count: 0, stop: null });
  stopWatch(w);
  w.count = 0;
  const observer = new MutationObserver((records) => { w.count += records.length; });
  const listeners = new AbortController();
  for (const d of docs()) {
    observer.observe(d, { subtree: true, childList: true, attributes: true, characterData: true });
    for (const type of withScroll ? ["input", "scroll"] : ["input"]) {
      d.addEventListener(type, () => { w.count += 1; }, { capture: true, signal: listeners.signal });
    }
  }
  w.stop = () => { observer.disconnect(); listeners.abort(); };
};
`;

export function signalsScript(): string {
  return `(() => {
${PAGE_COMMON}
return signals();
})()`;
}

/** Start counting what the page does next, for an action that goes through no page script */
export function watchScript(): string {
  return `(() => {
${PAGE_COMMON}
watchChanges(true);
})()`;
}

export function snapshotScript(opts: SnapshotOptions): string {
  const { maxElements, maxText } = snapshotCaps(opts.full);
  return `((opts) => {
${PAGE_COMMON}
const g = globalThis;
if (!g.__exegol) g.__exegol = { refs: new Map(), ids: new WeakMap(), next: 1, doc: Math.random().toString(36).slice(2, 6).padEnd(4, "0") };
const st = g.__exegol;
for (const [k, w] of st.refs) if (!w.deref() || !w.deref().isConnected) st.refs.delete(k);
const SEL = 'a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=link],[role=checkbox],[role=radio],[role=tab],[role=menuitem],[role=switch],[role=combobox],[role=textbox],[role=option],[contenteditable=""],[contenteditable=true],[onclick],[tabindex]:not([tabindex="-1"])';
const INPUT_ROLE = { checkbox: "checkbox", radio: "radio", submit: "button", button: "button", reset: "button", range: "slider", search: "searchbox" };
const TAG_ROLE = { A: "link", BUTTON: "button", SELECT: "combobox", TEXTAREA: "textbox", SUMMARY: "button" };
const roleOf = (el) => el.getAttribute("role") || TAG_ROLE[el.tagName] ||
  (el.tagName === "INPUT" ? INPUT_ROLE[el.type] || "textbox" : el.isContentEditable ? "textbox" : "clickable");
const clean = (s) => (s || "").replace(/\\s+/g, " ").trim().slice(0, 80);
const nameOf = (el) => {
  const aria = el.getAttribute("aria-label");
  if (aria) return clean(aria);
  const by = el.getAttribute("aria-labelledby");
  if (by) { const t = by.split(/\\s+/).map((id) => el.getRootNode().getElementById?.(id)?.innerText || "").join(" "); if (clean(t)) return clean(t); }
  if (el.labels && el.labels.length) return clean(el.labels[0].innerText);
  if (el.tagName === "INPUT" && (el.type === "submit" || el.type === "button")) return clean(el.value);
  return clean(el.placeholder || el.getAttribute("alt") || el.title || el.innerText || el.getAttribute("name") || "");
};
const cursors = new Map();
const cursorOf = (el) => {
  let c = cursors.get(el);
  if (c === undefined) { c = getComputedStyle(el).cursor; cursors.set(el, c); }
  return c;
};
// A div with only a framework handler shows as the outermost node with a pointer cursor
const pointerRoot = (el) => {
  if (el.tagName === "HTML" || el.tagName === "BODY" || cursorOf(el) !== "pointer") return false;
  const up = el.parentElement;
  return !up || cursorOf(up) !== "pointer";
};
const nearView = (el) => {
  const r = el.getBoundingClientRect();
  const h = el.ownerDocument.defaultView.innerHeight;
  return r.bottom > -h && r.top < 2 * h;
};
const NO_CONTROLS = new Set(["HEAD", "SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "svg"]);
const elements = [];
let walked = 0, framesSkipped = 0, more = false, skipped = 0, offscreen = 0, nextOffset = null;
/** False once the list is full */
const take = (el, listed) => {
  if (!vis(el)) return true;
  if (!opts.full && !nearView(el)) { offscreen += 1; return true; }
  if (!listed && !el.getAttribute("aria-label") && !el.textContent.trim()) return true;
  if (skipped < opts.offset) { skipped += 1; return true; }
  if (elements.length >= ${maxElements}) { more = true; nextOffset = opts.offset + elements.length; return false; }
  let ref = st.ids.get(el);
  if (!ref) { ref = "e" + st.next++ + "." + st.doc; st.ids.set(el, ref); }
  st.refs.set(ref, new WeakRef(el));
  const item = { ref, role: roleOf(el), name: nameOf(el), tag: el.tagName.toLowerCase() };
  if (el.tagName === "INPUT") {
    item.type = el.type;
    if (el.type === "checkbox" || el.type === "radio") item.checked = el.checked;
    else if (!isSecret(el)) item.value = String(el.value || "").slice(0, 120);
  } else if (el.tagName === "TEXTAREA" || el.tagName === "SELECT") {
    if (!isSecret(el)) item.value = String(el.value || "").slice(0, 120);
  }
  if (el.disabled || el.getAttribute("aria-disabled") === "true") item.disabled = true;
  if (el.tagName === "A") item.href = String(el.getAttribute("href") || "").slice(0, 160);
  elements.push(item);
  return true;
};
/** False once the walk is over */
const visit = (root) => {
  const walker = (root.ownerDocument || root).createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
    acceptNode: (n) => (NO_CONTROLS.has(n.tagName) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  while (walker.nextNode()) {
    const el = walker.currentNode;
    if (walked++ >= ${MAX_WALK}) { more = true; return false; }
    const listed = el.matches(SEL);
    if ((listed || pointerRoot(el)) && !take(el, listed)) return false;
    if (el.shadowRoot && !visit(el.shadowRoot)) return false;
    if (el.tagName === "IFRAME" || el.tagName === "FRAME") {
      const inner = frameDoc(el);
      if (inner && inner.documentElement) { if (!visit(inner)) return false; }
      else if (vis(el)) framesSkipped += 1;
    }
  }
  return true;
};
visit(document);
const page = (document.body ? document.body.innerText : "").replace(/\\n{3,}/g, "\\n\\n").trim();
const text = page.slice(opts.textOffset, opts.textOffset + ${maxText + 1});
return { ...signals(), text, elements, more, offscreen, nextOffset, textLength: page.length, framesSkipped };
})(${JSON.stringify(opts)})`;
}

/** browser_eval's code behind the host guard. Its completion value stays the code's own */
export function guardedEvalScript(code: string, expectedHost: string): string {
  return `${HOST_GUARD(expectedHost)}\n${code}`;
}

export const isPageChangedError = (err: unknown): boolean =>
  String(err instanceof Error ? err.message : err).includes("exegol:page_changed");

const KEY_RE =
  /^((Shift|Control|Alt|Meta)\+){0,3}([A-Za-z0-9]|Enter|Tab|Escape|Backspace|Delete|Space|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Home|End|PageUp|PageDown|F[1-9]|F1[0-2])$/;

/** "Shift+Tab" to Electron's key code and modifiers, or null */
export function parseKey(raw: unknown): { keyCode: string; modifiers: string[] } | null {
  if (typeof raw !== "string" || !KEY_RE.test(raw)) return null;
  const parts = raw.split("+");
  const keyCode = parts.pop() as string;
  return { keyCode, modifiers: parts.map((m) => m.toLowerCase()) };
}
