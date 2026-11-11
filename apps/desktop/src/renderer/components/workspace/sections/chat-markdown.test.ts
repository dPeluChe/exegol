import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChatMarkdown } from "./ChatMarkdown";

const render = (text: string) =>
  renderToStaticMarkup(createElement(ChatMarkdown, { text, agentId: "a1" }));

describe("ChatMarkdown", () => {
  it("formats what agents write most", () => {
    const html = render(
      "**Pruebas**\n\n- uno\n- `dos`\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```ts\nconst x = 1;\n```",
    );
    expect(html).toContain("<strong");
    expect(html).toContain("<li");
    expect(html).toContain("<table");
    expect(html).toContain("<pre");
    expect(html).not.toContain("|---|");
  });

  it("keeps untrusted output inert", () => {
    const html = render(
      '[click](https://evil.example/x) ![p](https://evil.example/p.png) https://evil.example/y\n\n<img src=x onerror=alert(1)>\n\n<script>alert(1)</script>\n\n<a href="javascript:alert(1)">z</a>\n\n[j](javascript:alert(1))',
    );
    expect(html).not.toMatch(/<(a|img|script|iframe)\b/);
    expect(html).not.toMatch(/<[^>]*\s(href|src|onerror)=/);
    expect(html).toContain("&lt;script&gt;");
  });

  it("offers only http(s) and paths, with the host beside a label hiding it", () => {
    const clicks = (text: string) => render(text).match(/<button/g)?.length ?? 0;
    expect(render("[click](https://evil.example/x)")).toContain("(evil.example)");
    expect(clicks("![p](https://evil.example/p.png)")).toBe(1);
    expect(clicks("[j](javascript:alert(1))")).toBe(0);
    expect(clicks("![d](data:image/png;base64,AAAA)")).toBe(0);
    expect(clicks("`/Users/x/app/src/main.ts`")).toBe(1);
    expect(clicks("`const x = 1`")).toBe(0);
  });

  it("with no session: links are text, or only web ones open when asked", () => {
    const clicks = (text: string, webLinks: boolean) =>
      renderToStaticMarkup(createElement(ChatMarkdown, { text, webLinks })).match(/<button/g)
        ?.length ?? 0;
    expect(clicks("https://example.com/a", false)).toBe(0);
    expect(clicks("https://example.com/a", true)).toBe(1);
    expect(clicks("`/Users/x/app/src/main.ts`", true)).toBe(0);
    expect(clicks("[j](javascript:alert(1))", true)).toBe(0);
  });
});
