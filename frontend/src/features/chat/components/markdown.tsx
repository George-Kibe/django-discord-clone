import ReactMarkdown, { defaultUrlTransform, type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { MENTION_SCHEME } from "../mentions";

/**
 * Message Markdown (FR-MSG-01): a safe subset. react-markdown never renders raw HTML;
 * the element allow-list below drops headings, images, tables and anything else.
 */
const ALLOWED = [
  "p",
  "strong",
  "em",
  "del",
  "code",
  "pre",
  "a",
  "blockquote",
  "ul",
  "ol",
  "li",
  "br",
];

export type MentionStyle = { roleColors?: Map<string, number>; highlightIds?: Set<string> };

function MentionPill({
  href,
  children,
  style,
}: {
  href: string;
  children: React.ReactNode;
  style: MentionStyle;
}) {
  const [, kind, id] = href.replace(MENTION_SCHEME, "mention/").split("/");
  const color = kind === "role" && id ? style.roleColors?.get(id) : undefined;
  const hex = color ? `#${color.toString(16).padStart(6, "0")}` : undefined;
  return (
    <span
      // Foreground text on a tint keeps WCAG contrast on any background (incl. the amber
      // "mentions you" highlight); a role's colour shows in the tint and underline.
      className="rounded bg-primary/25 px-0.5 font-semibold text-foreground"
      style={hex ? { backgroundColor: `${hex}33`, boxShadow: `inset 0 -2px 0 ${hex}` } : undefined}
      data-mention={kind}
    >
      {children}
    </span>
  );
}

function ExternalLink({ href, children }: { href?: string; children?: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="text-brand underline underline-offset-2"
    >
      {children}
    </a>
  );
}

const baseComponents: Components = {
  code: ({ children, className }) => (
    <code
      className={className ? className : "rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]"}
    >
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre className="my-1 overflow-x-auto rounded-md bg-muted p-2 font-mono text-sm">{children}</pre>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-l-4 border-border pl-2">{children}</blockquote>
  ),
  ul: ({ children }) => <ul className="list-disc pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-5">{children}</ol>,
  p: ({ children }) => <p className="break-words whitespace-pre-wrap">{children}</p>,
};

/** Keeps our internal mention:// links; everything else goes through the default sanitizer. */
function urlTransform(url: string): string {
  return url.startsWith(MENTION_SCHEME) ? url : defaultUrlTransform(url);
}

export function Markdown({
  children,
  mentions = {},
}: {
  children: string;
  mentions?: MentionStyle;
}) {
  const components: Components = {
    ...baseComponents,
    a: (props) =>
      props.href?.startsWith(MENTION_SCHEME) ? (
        <MentionPill href={props.href} style={mentions}>
          {props.children}
        </MentionPill>
      ) : (
        <ExternalLink href={props.href}>{props.children}</ExternalLink>
      ),
  };
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      allowedElements={ALLOWED}
      unwrapDisallowed
      components={components}
      urlTransform={urlTransform}
    >
      {children}
    </ReactMarkdown>
  );
}
