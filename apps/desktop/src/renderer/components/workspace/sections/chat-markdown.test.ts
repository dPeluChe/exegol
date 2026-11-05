import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChatMarkdown } from "./ChatMarkdown";

const render = (text: string) => renderToStaticMarkup(createElement(ChatMarkdown, { text }));

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
});
