import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

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

const components: Components = {
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="text-brand underline underline-offset-2"
    >
      {children}
    </a>
  ),
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

export function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      allowedElements={ALLOWED}
      unwrapDisallowed
      components={components}
    >
      {children}
    </ReactMarkdown>
  );
}
