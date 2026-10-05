// Scripts run in the page's isolated world (its own globals, the page's DOM): refs survive between
// calls on the same document and page code cannot tamper with them.

export const MAX_SNAPSHOT_ELEMENTS = 250;
export const MAX_SNAPSHOT_TEXT = 8_000;

export interface RawElement {
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

export interface RawSnapshot {
  url: string;
  title: string;
  text: string;
  elements: RawElement[];
  totalInteractive: number;
  hasPasswordField: boolean;
  hasCaptcha: boolean;
}

const REF_RE = /^e[1-9]\d{0,5}$/;

export function parseRef(raw: unknown): string | null {
  return typeof raw === "string" && REF_RE.test(raw.trim()) ? raw.trim() : null;
}

/** Elements as one line each ("e12 button "Save" [disabled]"): compact for the model */
export function formatElement(e: RawElement): string {
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
): {
  url: string;
  title: string;
  text: string;
  elements: string[];
  truncated: boolean;
} {
  const maxElements = caps.maxElements ?? MAX_SNAPSHOT_ELEMENTS;
  const maxText = caps.maxText ?? MAX_SNAPSHOT_TEXT;
  const text = raw.text.length > maxText ? `${raw.text.slice(0, maxText)}…` : raw.text;
  const elements = raw.elements.slice(0, maxElements).map(formatElement);
  return {
    url: raw.url,
    title: raw.title.slice(0, 300),
    text,
    elements,
    truncated:
      raw.text.length > maxText ||
      raw.elements.length > maxElements ||
      raw.totalInteractive > raw.elements.length,
  };
}

const COMMON = `
const vis = (el) => {
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return false;
  const s = getComputedStyle(el);
  return s.visibility !== "hidden" && s.display !== "none";
};
const isSecret = (el) =>
  !!el && el.tagName === "INPUT" &&
  (el.type === "password" || /password/i.test(el.autocomplete || "") || /passw|pwd/i.test(el.name || el.id || ""));
`;

export function snapshotScript(maxElements = MAX_SNAPSHOT_ELEMENTS): string {
  return `(() => {
${COMMON}
const g = globalThis;
if (!g.__exegol) g.__exegol = { refs: new Map(), ids: new WeakMap(), next: 1 };
const st = g.__exegol;
for (const [k, w] of st.refs) if (!w.deref() || !w.deref().isConnected) st.refs.delete(k);
const SEL = 'a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=link],[role=checkbox],[role=radio],[role=tab],[role=menuitem],[role=switch],[role=combobox],[role=textbox],[role=option],[contenteditable=""],[contenteditable=true]';
const INPUT_ROLE = { checkbox: "checkbox", radio: "radio", submit: "button", button: "button", reset: "button", range: "slider", search: "searchbox" };
const TAG_ROLE = { A: "link", BUTTON: "button", SELECT: "combobox", TEXTAREA: "textbox", SUMMARY: "button" };
const roleOf = (el) => el.getAttribute("role") || TAG_ROLE[el.tagName] ||
  (el.tagName === "INPUT" ? INPUT_ROLE[el.type] || "textbox" : el.isContentEditable ? "textbox" : "generic");
const clean = (s) => (s || "").replace(/\\s+/g, " ").trim().slice(0, 80);
const nameOf = (el) => {
  const aria = el.getAttribute("aria-label");
  if (aria) return clean(aria);
  const by = el.getAttribute("aria-labelledby");
  if (by) { const t = by.split(/\\s+/).map((id) => document.getElementById(id)?.innerText || "").join(" "); if (clean(t)) return clean(t); }
  if (el.labels && el.labels.length) return clean(el.labels[0].innerText);
  if (el.tagName === "INPUT" && (el.type === "submit" || el.type === "button")) return clean(el.value);
  return clean(el.placeholder || el.getAttribute("alt") || el.title || el.innerText || el.getAttribute("name") || "");
};
const all = [...document.querySelectorAll(SEL)].filter(vis);
const elements = [];
for (const el of all.slice(0, ${maxElements})) {
  let ref = st.ids.get(el);
  if (!ref) { ref = "e" + st.next++; st.ids.set(el, ref); }
  st.refs.set(ref, new WeakRef(el));
  const item = { ref, role: roleOf(el), name: nameOf(el), tag: el.tagName.toLowerCase() };
  if (el.tagName === "INPUT") {
    item.type = el.type;
    if (el.type === "checkbox" || el.type === "radio") item.checked = el.checked;
    else if (!isSecret(el)) item.value = String(el.value || "").slice(0, 120);
  } else if (el.tagName === "TEXTAREA" || el.tagName === "SELECT") {
    item.value = String(el.value || "").slice(0, 120);
  }
  if (el.disabled || el.getAttribute("aria-disabled") === "true") item.disabled = true;
  if (el.tagName === "A") item.href = String(el.getAttribute("href") || "").slice(0, 160);
  elements.push(item);
}
const pw = [...document.querySelectorAll("input")].some((el) => isSecret(el) && vis(el));
const captcha = !!document.querySelector('iframe[src*="recaptcha"],iframe[src*="hcaptcha"],iframe[src*="challenges.cloudflare.com"],.g-recaptcha,.h-captcha,.cf-turnstile');
const text = (document.body ? document.body.innerText : "").replace(/\\n{3,}/g, "\\n\\n").trim().slice(0, 20000);
return { url: location.href, title: document.title, text, elements, totalInteractive: all.length, hasPasswordField: pw, hasCaptcha: captcha };
})()`;
}

export type PageAction =
  | { action: "click" }
  | { action: "type"; text: string; submit?: boolean; append?: boolean }
  | { action: "select"; value: string }
  | { action: "check-focus" };

/** Act on a ref from the last snapshot. Args go in as JSON, never spliced as code */
export function actionScript(ref: string | null, act: PageAction): string {
  return `((ref, act) => {
${COMMON}
if (act.action === "check-focus") {
  return { ok: true, secret: isSecret(document.activeElement) };
}
const el = globalThis.__exegol?.refs.get(ref)?.deref();
if (!el || !el.isConnected) return { error: "stale_ref" };
el.scrollIntoView({ block: "center", inline: "center" });
if (el.disabled) return { error: "disabled" };
if (act.action === "click") {
  if (typeof el.focus === "function") el.focus();
  el.click();
  return { ok: true };
}
if (act.action === "type") {
  if (isSecret(el)) return { error: "password" };
  el.focus();
  if (el.isContentEditable) {
    if (!act.append) document.execCommand("selectAll", false);
    document.execCommand("insertText", false, act.text);
  } else if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    setter.call(el, act.append ? el.value + act.text : act.text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  } else {
    return { error: "not_typable" };
  }
  if (act.submit && el.form) {
    if (typeof el.form.requestSubmit === "function") el.form.requestSubmit(); else el.form.submit();
  }
  return { ok: true };
}
if (act.action === "select") {
  if (el.tagName !== "SELECT") return { error: "not_select" };
  const opt = [...el.options].find((o) => o.value === act.value) || [...el.options].find((o) => o.label.trim() === act.value);
  if (!opt) return { error: "no_option", options: [...el.options].slice(0, 50).map((o) => o.value) };
  el.value = opt.value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return { ok: true, value: opt.value };
}
return { error: "unknown_action" };
})(${JSON.stringify(ref)}, ${JSON.stringify(act)})`;
}

const KEY_RE =
  /^((Shift|Control|Alt|Meta)\+){0,3}([A-Za-z0-9]|Enter|Tab|Escape|Backspace|Delete|Space|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Home|End|PageUp|PageDown|F[1-9]|F1[0-2])$/;

/** "Shift+Tab" to Electron's key code and modifiers, or null */
export function parseKey(raw: unknown): { keyCode: string; modifiers: string[] } | null {
  if (typeof raw !== "string" || !KEY_RE.test(raw)) return null;
  const parts = raw.split("+");
  const keyCode = parts.pop() as string;
  return { keyCode, modifiers: parts.map((m) => m.toLowerCase()) };
}
