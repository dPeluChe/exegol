/** The app's own text input with the focus (not a terminal's or Monaco's hidden textarea) */
export function focusedField(): HTMLElement | null {
  const el = document.activeElement;
  if (!(el instanceof HTMLElement) || el.closest(".xterm, .monaco-editor")) return null;
  if (el instanceof HTMLTextAreaElement) return el.readOnly || el.disabled ? null : el;
  if (el instanceof HTMLInputElement) {
    const textual = ["text", "search", "url", "email", ""].includes(el.type);
    return textual && !el.readOnly && !el.disabled ? el : null;
  }
  return el.isContentEditable ? el : null;
}
