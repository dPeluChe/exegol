import { HOST_GUARD, PAGE_COMMON } from "./page-scripts";

export type PageAction =
  | { action: "click"; force?: boolean }
  | { action: "hover"; force?: boolean }
  | { action: "type"; text: string; submit?: boolean; append?: boolean }
  | { action: "select"; value: string };

export interface ActionResult {
  ok?: boolean;
  error?: string;
  /** What covers the element: page data */
  by?: string;
  options?: string[];
  /** The field holds something else than what was typed (a mask, maxlength): page data */
  actual?: string;
  /** Where a real mouse should move, in the top page's coordinates */
  x?: number;
  y?: number;
  /** "enter": no form around, so the caller sends a real Enter */
  submitted?: "form" | "enter";
}

/** Longer text goes in one step: a key sequence per character re-renders the page each time */
const MAX_STEPWISE_CHARS = 200;

/** Act on a ref from the last snapshot, on the host inspect checked. Args go in as JSON, never
 *  spliced as code. The script runs with a user gesture, so what it fires can open a popup */
export function actionScript(ref: string, act: PageAction, expectedHost: string): string {
  return `((ref, act) => {
${HOST_GUARD(expectedHost)}
${PAGE_COMMON}
const st = globalThis.__exegol;
if (!st || ref.split(".")[1] !== st.doc) return { error: "stale_ref" };
const el = st.refs.get(ref)?.deref();
if (!el || !el.isConnected) return { error: "stale_ref" };
el.scrollIntoView({ block: "center", inline: "center" });
if (el.disabled) return { error: "disabled" };
// The scroll above is ours: only what the page does next counts
watchChanges(false);
const root = el.getRootNode();
const doc = el.ownerDocument;
const win = doc.defaultView;
if (act.action === "click" || act.action === "hover") {
  const r = el.getBoundingClientRect();
  const x = r.left + r.width / 2, y = r.top + r.height / 2;
  if (!act.force) {
    const hit = root.elementFromPoint(x, y);
    const own = !hit || hit === el || el.contains(hit) || hit.contains(el) ||
      [...(el.labels || [])].some((l) => l.contains(hit));
    if (!own) return { error: "obscured", by: (hit.tagName.toLowerCase() + (hit.id ? "#" + hit.id : "") + (hit.getAttribute("role") ? " role=" + hit.getAttribute("role") : "")).slice(0, 80) };
  }
  const at = { bubbles: true, cancelable: true, composed: true, view: win, clientX: x, clientY: y, button: 0 };
  const pointer = (type, buttons) => el.dispatchEvent(new win.PointerEvent(type, { ...at, buttons, pointerId: 1, pointerType: "mouse", isPrimary: true }));
  const mouse = (type, buttons) => el.dispatchEvent(new win.MouseEvent(type, { ...at, buttons, detail: 1 }));
  pointer("pointerover", 0); mouse("mouseover", 0);
  el.dispatchEvent(new win.PointerEvent("pointerenter", { ...at, bubbles: false }));
  el.dispatchEvent(new win.MouseEvent("mouseenter", { ...at, bubbles: false }));
  pointer("pointermove", 0); mouse("mousemove", 0);
  // :hover answers only to a real mouse, which the caller sends; a frame has its own coordinates
  if (act.action === "hover") return win === window ? { ok: true, x, y } : { ok: true };
  const pressed = pointer("pointerdown", 1);
  const down = pressed ? mouse("mousedown", 1) : true;
  if (down && typeof el.focus === "function") el.focus();
  pointer("pointerup", 0);
  if (pressed) mouse("mouseup", 0);
  if (el.isConnected) mouse("click", 0);
  return { ok: true };
}
if (act.action === "type") {
  if (isSecret(el)) return { error: "password" };
  const field = el.tagName === "INPUT" || el.tagName === "TEXTAREA";
  if (!field && !el.isContentEditable) return { error: "not_typable" };
  if (el.readOnly) return { error: "read_only" };
  el.focus();
  const focused = root.activeElement === el;
  const key = (type, ch) => el.dispatchEvent(new win.KeyboardEvent(type, { key: ch === "\\n" ? "Enter" : ch.length === 1 ? ch : "Unidentified", bubbles: true, cancelable: true, composed: true, view: win }));
  const setValue = (v) => {
    const proto = el.tagName === "TEXTAREA" ? win.HTMLTextAreaElement.prototype : win.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v);
    el.dispatchEvent(new win.Event("input", { bubbles: true }));
  };
  const before = field ? el.value : "";
  const expected = act.append ? before + act.text : act.text;
  const insertable = !field || el.tagName === "TEXTAREA" || ["text", "search", "url", "tel", "email", "number"].includes(el.type);
  if (!insertable) {
    setValue(expected);
  } else {
    if (!act.append) {
      if (!field) { doc.execCommand("selectAll", false); doc.execCommand("delete", false); }
      else if (before) setValue("");
    }
    const chars = act.text.length <= ${MAX_STEPWISE_CHARS} ? Array.from(act.text) : [act.text];
    for (const ch of chars) {
      if (key("keydown", ch)) {
        key("keypress", ch);
        const inserted = focused && doc.execCommand("insertText", false, ch);
        if (!inserted && field) setValue(el.value + ch);
      }
      key("keyup", ch);
    }
  }
  if (field) el.dispatchEvent(new win.Event("change", { bubbles: true }));
  const actual = field && el.value !== expected ? String(el.value).slice(0, 200) : undefined;
  if (!act.submit) return { ok: true, actual };
  if (!el.form) return { ok: true, actual, submitted: "enter" };
  if (typeof el.form.requestSubmit === "function") el.form.requestSubmit(); else el.form.submit();
  return { ok: true, actual, submitted: "form" };
}
if (act.action === "select") {
  if (el.tagName !== "SELECT") return { error: "not_select" };
  const opt = [...el.options].find((o) => o.value === act.value) || [...el.options].find((o) => o.label.trim() === act.value);
  if (!opt) return { error: "no_option", options: [...el.options].slice(0, 50).map((o) => o.value) };
  el.value = opt.value;
  el.dispatchEvent(new win.Event("input", { bubbles: true }));
  el.dispatchEvent(new win.Event("change", { bubbles: true }));
  return { ok: true };
}
return { error: "unknown_action" };
})(${JSON.stringify(ref)}, ${JSON.stringify(act)})`;
}

export type ScrollTarget = "down" | "up" | "top" | "bottom";

/** The inner panel under the middle of the viewport when an app scrolls one, else the page */
export function scrollScript(ref: string | null, to: ScrollTarget, expectedHost: string): string {
  return `((ref, to) => {
${HOST_GUARD(expectedHost)}
${PAGE_COMMON}
watchChanges(true);
if (ref) {
  const st = globalThis.__exegol;
  const el = st && ref.split(".")[1] === st.doc ? st.refs.get(ref)?.deref() : null;
  if (!el || !el.isConnected) return { error: "stale_ref" };
  el.scrollIntoView({ block: "center", behavior: "instant" });
  return { ok: true };
}
let box = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
while (box && box !== document.body && box !== document.documentElement) {
  const overflow = getComputedStyle(box).overflowY;
  if ((overflow === "auto" || overflow === "scroll") && box.scrollHeight > box.clientHeight) break;
  box = box.parentElement;
}
if (!box || box === document.body || box === document.documentElement) box = document.scrollingElement;
const step = box.clientHeight * 0.8;
const top = to === "top" ? 0 : to === "bottom" ? box.scrollHeight : box.scrollTop + (to === "down" ? step : -step);
box.scrollTo({ top, behavior: "instant" });
return { ok: true, atEnd: box.scrollTop + box.clientHeight >= box.scrollHeight - 1 };
})(${JSON.stringify(ref)}, ${JSON.stringify(to)})`;
}

export interface WaitCondition {
  text?: string;
  gone?: string;
  url?: string;
}

export function waitScript(condition: WaitCondition, expectedHost: string): string {
  return `((c) => {
${HOST_GUARD(expectedHost)}
const shown = document.body ? document.body.innerText : "";
return (c.text === undefined || shown.includes(c.text)) &&
  (c.gone === undefined || !shown.includes(c.gone)) &&
  (c.url === undefined || location.href.includes(c.url));
})(${JSON.stringify(condition)})`;
}
