/** Code editors that can take dictated text at their cursor, found by the pane holding them
 *  (CodeViewer registers its Monaco instance; dictation never imports Monaco itself) */
interface TextEditorHandle {
  node: HTMLElement;
  /** False when read-only */
  insert: (text: string) => boolean;
}

const editors = new Set<TextEditorHandle>();

export function registerTextEditor(handle: TextEditorHandle): () => void {
  editors.add(handle);
  return () => editors.delete(handle);
}

/** The writable editor inside this pane's element took the text */
export function insertIntoEditorIn(root: Element, text: string): boolean {
  for (const editor of editors) {
    if (root.contains(editor.node)) return editor.insert(text);
  }
  return false;
}
