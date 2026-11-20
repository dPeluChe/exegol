import { skipsView, type ViewEntry, type ViewSource } from "./views";

const VALUES: readonly RegExp[] = [
  // 219, 219-some-title
  /^\d+(-|$)/,
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  // A hash: hex with a digit, so words of a-f stay words
  /^(?=[a-f]*\d)[0-9a-f]{8,}$/i,
  // A generated id: long, letters and digits mixed
  /^(?=[a-z]*\d)(?=\d*[a-z])[0-9a-z]{16,}$/i,
  // ERR-219, iss_abc123
  /^[a-z]{2,5}[_-](?=[0-9a-z]*\d)[0-9a-z]{3,}$/i,
];

/** A path with its values replaced (`/errors/219` is `/errors/:id`), null when it has none:
 *  paths of one shape are one view. Never the first segment (`/404`), never plain words */
export function viewShape(path: string): string | null {
  const parts = path.split("/");
  const shaped = parts.map((part, i) => (i > 1 && VALUES.some((v) => v.test(part)) ? ":id" : part));
  return shaped.some((part, i) => part !== parts[i]) ? shaped.join("/") : null;
}

/** The view that stands for a path: its own, else the one kept for its shape */
export function viewResolver(views: readonly ViewEntry[]): (path: string) => string | null {
  const paths = new Set(views.map((v) => v.path));
  const shapes = new Map(views.flatMap((v) => (v.shape ? [[v.shape, v.path] as const] : [])));
  return (path) => (paths.has(path) ? path : (shapes.get(viewShape(path) ?? "") ?? null));
}

export interface ViewIndex {
  /** `fresh`: a view to load. Else the kept view of that shape, which now stands for one more.
   *  Null: known, skipped or over the limit */
  add(path: string, source: ViewSource): { view: ViewEntry; fresh: boolean } | null;
  /** A failed view gives its place to another path of its shape, once per shape */
  replace(failed: ViewEntry): ViewEntry | null;
}

/** The views of a pass: one per path, and one per shape of path (a list of 40 rows is one
 *  detail page, not 40) */
export function viewIndex(
  max: number,
  facts: (path: string) => Pick<ViewEntry, "inSitemap" | "robotsBlocked">,
): ViewIndex {
  const byPath = new Map<string, ViewEntry>();
  const shaped = new Map<string, { view: ViewEntry; others: Set<string>; replaced: boolean }>();
  const make = (path: string, source: ViewSource, shape: string | null): ViewEntry => {
    const view: ViewEntry = {
      path,
      ...(shape ? { shape } : {}),
      sources: [source],
      status: "waiting",
      ...facts(path),
    };
    byPath.set(path, view);
    return view;
  };
  return {
    add(path, source) {
      const known = byPath.get(path);
      if (known) {
        if (!known.sources.includes(source)) known.sources.push(source);
        return null;
      }
      if (skipsView(path)) return null;
      const shape = viewShape(path);
      const kept = shape ? shaped.get(shape) : undefined;
      if (kept) {
        if (kept.others.has(path)) return null;
        kept.others.add(path);
        kept.view.alike = kept.others.size;
        return { view: kept.view, fresh: false };
      }
      if (byPath.size >= max) return null;
      const view = make(path, source, shape);
      if (shape) shaped.set(shape, { view, others: new Set(), replaced: false });
      return { view, fresh: true };
    },
    replace(failed) {
      const kept = failed.shape ? shaped.get(failed.shape) : undefined;
      const [next] = kept?.others ?? [];
      if (!kept || kept.view !== failed || kept.replaced || !next) return null;
      kept.others.delete(next);
      kept.replaced = true;
      failed.alike = undefined;
      kept.view = make(next, "links", failed.shape ?? null);
      if (kept.others.size) kept.view.alike = kept.others.size;
      return kept.view;
    },
  };
}
