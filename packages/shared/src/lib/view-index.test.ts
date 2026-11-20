import { describe, expect, it } from "vitest";
import { viewIndex, viewResolver, viewShape } from "./view-index";

const index = (max = 10) => viewIndex(max, () => ({ inSitemap: false, robotsBlocked: false }));

describe("viewShape", () => {
  it("takes the values out of a path", () => {
    expect(
      [
        "/errors/219",
        "/orgs/acme/users/3f2a9c1e-0b4d-4e7a-9c1d-2f3a4b5c6d7e",
        "/traces/01hq8z3k9v2m4n6p8r0s2t4v6x",
        "/commits/9fceb02d",
        "/posts/219-some-title",
        "/issues/ERR-219",
      ].map(viewShape),
    ).toEqual([
      "/errors/:id",
      "/orgs/acme/users/:id",
      "/traces/:id",
      "/commits/:id",
      "/posts/:id",
      "/issues/:id",
    ]);
  });

  it("leaves words, versions and a first segment alone", () => {
    expect(
      ["/", "/404", "/errors", "/blog/removed-features", "/settings/deadbeef", "/docs/v2"].map(
        viewShape,
      ),
    ).toEqual([null, null, null, null, null, null]);
  });
});

describe("viewIndex", () => {
  it("keeps one view per shape and counts the others on it", () => {
    const views = index();
    const first = views.add("/errors/219", "links");
    expect(first).toMatchObject({ fresh: true, view: { shape: "/errors/:id" } });
    expect(views.add("/errors/220", "links")).toEqual({ view: first?.view, fresh: false });
    expect(views.add("/errors/220", "links")).toBeNull();
    expect(first?.view.alike).toBe(1);
    expect(views.add("/errors", "links")?.fresh).toBe(true);
  });

  it("counts a path alike past the limit, and adds a source to a known one", () => {
    const views = index(1);
    const first = views.add("/errors/1", "links");
    expect(views.add("/about", "links")).toBeNull();
    expect(views.add("/errors/2", "links")?.fresh).toBe(false);
    expect(views.add("/errors/1", "sitemap")).toBeNull();
    expect(first?.view.sources).toEqual(["links", "sitemap"]);
  });

  it("gives a failed view's place to another path of its shape, once", () => {
    const views = index();
    const first = views.add("/errors/1", "links")?.view;
    views.add("/errors/2", "links");
    views.add("/errors/3", "links");
    if (!first) throw new Error("no view");
    const next = views.replace(first);
    expect(next).toMatchObject({ path: "/errors/2", alike: 1 });
    expect(first.alike).toBeUndefined();
    expect(next && views.replace(next)).toBeNull();
    expect(views.add("/errors/4", "links")?.view).toBe(next);
  });
});

describe("viewResolver", () => {
  it("sends a path that was left out to the view of its shape", () => {
    const kept = index().add("/errors/219", "links")?.view;
    const resolve = viewResolver(kept ? [kept] : []);
    expect(["/errors/219", "/errors/220", "/sessions/4"].map(resolve)).toEqual([
      "/errors/219",
      "/errors/219",
      null,
    ]);
  });
});
