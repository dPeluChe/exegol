import {
  type ComponentType,
  createContext,
  createElement,
  type ReactNode,
  useContext,
  useMemo,
} from "react";
import { type Components, defaultRemarkPlugins, Streamdown } from "streamdown";
import { isHttpUrl } from "../../../lib/browser-viewports";
import { type NameLink, nameSplitter, parseJump } from "../../../lib/name-links";
import { openInBrowser } from "../../../lib/open-in-browser";
import { jumpToAgent, showProject } from "../../../stores/agents";
import { openTerminalUrl, openUnresolvedFile } from "../../terminal/terminal-link-actions";
import { findFileMatches, type LinkMatch } from "../../terminal/terminal-links";

interface MarkdownNode {
  type: string;
  value?: string;
  url?: string;
  children?: MarkdownNode[];
}

function htmlToText(node: MarkdownNode) {
  if (node.type === "html") node.type = "text";
  node.children?.forEach(htmlToText);
}

type Split = ReturnType<typeof nameSplitter>;

function linkNames(node: MarkdownNode, split: Split) {
  if (!node.children || node.type === "link" || node.type === "code") return;
  node.children = node.children.flatMap((child): MarkdownNode[] => {
    if (child.type !== "text" || !child.value) {
      linkNames(child, split);
      return [child];
    }
    return split(child.value).map((part) =>
      typeof part === "string"
        ? { type: "text", value: part }
        : { type: "link", url: part.href, children: [{ type: "text", value: part.name }] },
    );
  });
}

/** Known session and project names in prose become links to them; code and links stay as
 *  written. Named, with the names as its options: Streamdown caches a processor by both */
function remarkNameLinks(links: NameLink[]) {
  const split = nameSplitter(links);
  return (tree: MarkdownNode) => linkNames(tree, split);
}

/** The sessions and projects a chat can jump to by name; empty where there is nowhere to jump */
export const ChatNames = createContext<NameLink[]>([]);

const REMARK_PLUGINS = [...Object.values(defaultRemarkPlugins), () => htmlToText];
const NO_REHYPE_PLUGINS: [] = [];

interface ElementProps {
  children?: ReactNode;
  href?: string;
  alt?: string;
  src?: string;
}

/** Who opens a link: the session (its preview pane, its files), or only the browser for web links */
const ChatLinks = createContext<{ agentId: string | null; web: boolean }>({
  agentId: null,
  web: false,
});

/** A whole path, as a CLI prints it. Main resolves and confines it, as for a terminal click */
function fileMatch(text: string): LinkMatch | undefined {
  const match = findFileMatches(text)[0];
  return match?.index === 0 && match.length === text.length ? match : undefined;
}

const hostOf = (url: string) => (URL.canParse(url) ? new URL(url).host : url);

/** http(s) opens in the browser, a path in the file window, anything else stays text. The host
 *  shows beside a label that hides it: a link's text proves nothing */
function ChatLink({
  target,
  children,
  shown = String(children) === target,
}: {
  target: string;
  children: ReactNode;
  /** The label already is the address */
  shown?: boolean;
}) {
  const { agentId, web } = useContext(ChatLinks);
  const jump = parseJump(target);
  if (jump) {
    return (
      <button
        type="button"
        title={jump.kind === "session" ? "Open this session" : "Open this project"}
        onClick={() => {
          if (jump.kind === "session") jumpToAgent(jump.agentId, jump.projectId);
          else showProject(jump.projectId);
        }}
        className="text-left text-accent underline decoration-accent/40 hover:decoration-accent"
      >
        {children}
      </button>
    );
  }
  const url = isHttpUrl(target);
  const file = url || !agentId ? undefined : fileMatch(target);
  const clickable = url ? !!agentId || web : !!file;
  if (!clickable) {
    return (
      <span className="underline decoration-text-muted" title={target}>
        {children}
      </span>
    );
  }
  return (
    <button
      type="button"
      title={target}
      onClick={() => {
        if (!agentId) openInBrowser(target);
        else if (file) openUnresolvedFile(agentId, file, "plain");
        else openTerminalUrl(agentId, target, "mod");
      }}
      className="break-all text-left text-accent underline decoration-accent/40 hover:decoration-accent"
    >
      {children}
      {url && !shown && <span className="text-text-muted"> ({hostOf(target)})</span>}
    </button>
  );
}

const CODE = "rounded bg-bg-primary px-1 py-px font-mono text-[11px]";

function InlineCode({ children }: ElementProps) {
  const text = typeof children === "string" ? children : "";
  const code = <code className={CODE}>{children}</code>;
  if (!isHttpUrl(text) && !fileMatch(text)) return code;
  return (
    <ChatLink target={text} shown>
      {code}
    </ChatLink>
  );
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
  inlineCode: InlineCode,
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
  a: ({ children, href }) => <ChatLink target={href ?? ""}>{children}</ChatLink>,
  // Never loaded: a remote image reports whoever reads it. Its address stays one click away
  img: ({ alt, src }) => (
    <span className="text-text-muted">
      {alt ? `${alt}: ` : "Image: "}
      {src?.startsWith("data:") ? "embedded" : <ChatLink target={src ?? ""}>{src}</ChatLink>}
    </span>
  ),
};

/** Agent text is untrusted: formatted, but its HTML is text and nothing loads or runs by itself */
/** No `agentId` (a note): links show as text, since there is no session to open them in, unless
 *  `webLinks` sends http(s) ones to the browser on a click */
export function ChatMarkdown({
  text,
  agentId,
  webLinks = false,
}: {
  text: string;
  agentId?: string;
  webLinks?: boolean;
}) {
  const links = useMemo(() => ({ agentId: agentId ?? null, web: webLinks }), [agentId, webLinks]);
  const names = useContext(ChatNames);
  const remarkPlugins = useMemo(
    () =>
      names.length > 0
        ? [...REMARK_PLUGINS, [remarkNameLinks, names] as [typeof remarkNameLinks, NameLink[]]]
        : REMARK_PLUGINS,
    [names],
  );
  return (
    <ChatLinks.Provider value={links}>
      <Streamdown
        mode="static"
        parseIncompleteMarkdown={false}
        controls={false}
        components={COMPONENTS as Components}
        remarkPlugins={remarkPlugins}
        rehypePlugins={NO_REHYPE_PLUGINS}
        className="min-w-0 break-words leading-relaxed"
      >
        {text}
      </Streamdown>
    </ChatLinks.Provider>
  );
}
