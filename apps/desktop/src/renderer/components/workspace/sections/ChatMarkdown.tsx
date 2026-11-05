import { type ComponentType, createElement, type ReactNode } from "react";
import { type Components, defaultRemarkPlugins, Streamdown } from "streamdown";

interface MarkdownNode {
  type: string;
  children?: MarkdownNode[];
}

function htmlToText(node: MarkdownNode) {
  if (node.type === "html") node.type = "text";
  node.children?.forEach(htmlToText);
}

const REMARK_PLUGINS = [...Object.values(defaultRemarkPlugins), () => htmlToText];
const NO_REHYPE_PLUGINS: [] = [];

interface ElementProps {
  children?: ReactNode;
  href?: string;
  alt?: string;
}

// Only children pass through: href, src and any other attribute never reach the DOM
const styled = (tag: string, className: string) => (props: ElementProps) =>
  createElement(tag, { className }, props.children);

const heading = "mb-1 mt-2.5 font-semibold text-text-primary first:mt-0";

const COMPONENTS: Record<string, ComponentType<ElementProps>> = {
  p: styled("p", "my-1.5 first:mt-0 last:mb-0"),
  h1: styled("h4", `${heading} text-sm`),
  h2: styled("h4", `${heading} text-[13px]`),
  h3: styled("h4", heading),
  h4: styled("h4", heading),
  h5: styled("h4", heading),
  h6: styled("h4", heading),
  strong: styled("strong", "font-semibold text-text-primary"),
  em: styled("em", "italic"),
  del: styled("del", "line-through"),
  ul: styled("ul", "my-1.5 list-disc space-y-0.5 pl-4"),
  ol: styled("ol", "my-1.5 list-decimal space-y-0.5 pl-5"),
  li: styled("li", ""),
  blockquote: styled("blockquote", "my-1.5 border-l-2 border-border pl-2 text-text-secondary"),
  hr: styled("hr", "my-2.5 border-border"),
  pre: styled("pre", "my-1.5 overflow-x-auto rounded bg-bg-primary p-2 text-[11px] leading-snug"),
  code: styled("code", "font-mono"),
  inlineCode: styled("code", "rounded bg-bg-primary px-1 py-px font-mono text-[11px]"),
  thead: styled("thead", "text-text-primary"),
  tbody: styled("tbody", ""),
  tr: styled("tr", ""),
  th: styled("th", "border border-border px-1.5 py-1 text-left font-semibold"),
  td: styled("td", "border border-border px-1.5 py-1 align-top"),
  table: ({ children }) => (
    <div className="my-1.5 overflow-x-auto">
      <table className="w-full border-collapse text-[11px]">{children}</table>
    </div>
  ),
  a: ({ children, href }) => (
    <span className="underline decoration-text-muted" title={href}>
      {children}
    </span>
  ),
  img: ({ alt }) => <span className="text-text-muted">{alt || "image"}</span>,
};

/** Agent text is untrusted: formatted, but its HTML is text, links stay inert, nothing loads */
export function ChatMarkdown({ text }: { text: string }) {
  return (
    <Streamdown
      mode="static"
      parseIncompleteMarkdown={false}
      controls={false}
      components={COMPONENTS as Components}
      remarkPlugins={REMARK_PLUGINS}
      rehypePlugins={NO_REHYPE_PLUGINS}
      className="min-w-0 break-words leading-relaxed"
    >
      {text}
    </Streamdown>
  );
}
