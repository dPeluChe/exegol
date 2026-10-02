/** Cmd+L: select the address bar inside `root` (a browser pane, or the floating browser) */
export function focusAddressBar(root: ParentNode = document): boolean {
  const input = root.querySelector<HTMLInputElement>("input[data-address-bar]");
  if (!input) return false;
  input.focus();
  input.select();
  return true;
}
