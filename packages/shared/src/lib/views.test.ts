import { describe, expect, it } from "vitest";
import {
  layoutViews,
  parentView,
  parseRobots,
  parseSitemap,
  robotsBlocks,
  routesFromFiles,
  skipsView,
  viewPath,
} from "./views";

describe("routesFromFiles", () => {
  it("reads Next, SvelteKit and Astro page files and sets patterns apart", () => {
    const { paths, patterns } = routesFromFiles([
      "src/app/(landing)/page.tsx",
      "src/app/(landing)/about/page.tsx",
      "src/app/dashboard/users/[id]/page.tsx",
      "src/app/dashboard/layout.tsx",
      "src/app/api/chat/route.ts",
      "src/app/@modal/login/page.tsx",
      "pages/blog/index.tsx",
      "pages/api/hello.ts",
      "pages/_app.tsx",
      "src/pages/[...lang]/index.astro",
      "src/pages/robots.txt.ts",
      "src/routes/settings/+page.svelte",
      "src/routes/settings/+page.server.ts",
    ]);
    expect(paths).toEqual(["/", "/about", "/blog", "/settings"]);
    expect(patterns).toEqual(["/[...lang]", "/dashboard/users/[id]"]);
  });
});

describe("viewPath and skipsView", () => {
  it("keys a page without query, hash or trailing slash", () => {
    expect(viewPath("/a/b/?x=1#top")).toBe("/a/b");
    expect(viewPath("/")).toBe("/");
  });

  it("leaves out what may act on a load and what is no page", () => {
    expect(
      ["/logout", "/auth/sign-out", "/users/delete/3", "/api/x", "/logo.png"].map(skipsView),
    ).toEqual([true, true, true, true, true]);
    expect(["/", "/blog/removed-features", "/v1.2/docs/"].map(skipsView)).toEqual([
      false,
      false,
      false,
    ]);
  });
});

describe("robots and sitemap", () => {
  const rules = parseRobots(
    [
      "User-agent: bot",
      "Disallow: /",
      "",
      "User-agent: *",
      "Disallow: /dashboard",
      "Disallow: /*.pdf$",
      "Allow: /dashboard/public # open",
      "Sitemap: http://localhost:3000/sitemap.xml",
    ].join("\n"),
  );

  it("keeps the rules for every crawler and the sitemaps", () => {
    expect(rules.disallow).toEqual(["/dashboard", "/*.pdf$"]);
    expect(rules.sitemaps).toEqual(["http://localhost:3000/sitemap.xml"]);
  });

  it("lets the longest rule decide", () => {
    expect(robotsBlocks(rules, "/dashboard/users")).toBe(true);
    expect(robotsBlocks(rules, "/dashboard/public/x")).toBe(false);
    expect(robotsBlocks(rules, "/files/a.pdf")).toBe(true);
    expect(robotsBlocks(rules, "/about")).toBe(false);
  });

  it("reads locs and tells an index from a sitemap", () => {
    expect(
      parseSitemap(
        "<urlset><url><loc>https://x.dev/a?b=1&amp;c=2</loc></url><url><loc> https://x.dev/ </loc></url></urlset>",
      ),
    ).toEqual({ index: false, locs: ["https://x.dev/a?b=1&c=2", "https://x.dev/"] });
    expect(
      parseSitemap(
        "<sitemapindex><sitemap><loc>https://x.dev/s1.xml</loc></sitemap></sitemapindex>",
      ).index,
    ).toBe(true);
  });
});

describe("layoutViews", () => {
  const opts = { cardWidth: 100, cardHeight: () => 50, gapX: 10, gapY: 20, perRow: 2 };

  it("hangs a view from its nearest listed ancestor", () => {
    const all = new Set(["/", "/a", "/a/b/c"]);
    expect(parentView("/a/b/c", all)).toBe("/a");
    expect(parentView("/z", all)).toBe("/");
    expect(parentView("/z", new Set(["/z"]))).toBeNull();
  });

  it("wraps children in rows and never overlaps two cards", () => {
    const paths = ["/", "/a", "/b", "/c", "/a/x", "/a/y", "/a/z"];
    const tall = { ...opts, cardHeight: (p: string) => (p === "/b" ? 120 : 50) };
    const { boxes, lines, width } = layoutViews(paths, tall);
    expect(boxes).toHaveLength(paths.length);
    expect(lines).toHaveLength(paths.length - 1);
    for (const a of boxes) {
      for (const b of boxes) {
        if (a === b) continue;
        const apart =
          a.x + a.width <= b.x ||
          b.x + b.width <= a.x ||
          a.y + a.height <= b.y ||
          b.y + b.height <= a.y;
        expect(apart).toBe(true);
      }
    }
    const at = (p: string) => boxes.find((b) => b.path === p);
    expect(at("/c")?.y).toBeGreaterThan((at("/b")?.y ?? 0) + 120);
    expect(Math.max(...boxes.map((b) => b.x + b.width))).toBeLessThanOrEqual(width);
    expect(Math.min(...boxes.map((b) => b.x))).toBeGreaterThanOrEqual(0);
  });
});
