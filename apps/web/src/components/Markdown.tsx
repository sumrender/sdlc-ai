import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "~/lib/utils";

export interface MarkdownProps {
  text: string;
  className?: string;
}

/**
 * Renders agent- or user-authored Markdown (Planner plans, questions,
 * review findings, task descriptions) with card-consistent Tailwind styles.
 *
 * Raw HTML is not rendered (no rehype-raw), so this is safe for untrusted
 * agent output. Log/streaming output must NOT use this — keep <pre>.
 */
export function Markdown({ text, className }: MarkdownProps) {
  return (
    <div className={cn("min-w-0 text-sm leading-relaxed text-foreground [&>*:first-child]:mt-0 [&>*:last-child]:mb-0", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

const components: Components = {
  p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
  h1: ({ children }) => <h1 className="mb-2 mt-4 text-base font-semibold tracking-tight first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-1.5 mt-4 text-[15px] font-semibold tracking-tight first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-1 mt-3 text-sm font-semibold first:mt-0">{children}</h3>,
  h4: ({ children }) => <h4 className="mb-1 mt-3 text-[13px] font-semibold first:mt-0">{children}</h4>,
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed [&>p]:my-0.5 [&>ul]:my-1 [&>ol]:my-1">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline">
      {children}
    </a>
  ),
  blockquote: ({ children }) => <blockquote className="my-2 border-l-2 border-border pl-3 text-muted-foreground">{children}</blockquote>,
  hr: () => <hr className="my-3 border-border" />,
  code: ({ children, className }) => {
    // GFM code fence: react-markdown renders <pre><code class="language-x">.
    // Inline code has no language class.
    const isBlock = className?.includes("language-");
    if (isBlock) return <code className={className}>{children}</code>;
    return <code className="break-words rounded bg-secondary px-1 py-0.5 font-mono text-[13px]">{children}</code>;
  },
  pre: ({ children }) => (
    <pre className="my-2 overflow-x-auto rounded-lg border border-border bg-secondary/40 p-3 font-mono text-[12px] leading-5 [&>code]:bg-transparent [&>code]:p-0">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto rounded-lg border border-border">
      <table className="w-full border-collapse text-[13px]">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border-b border-border bg-secondary/60 px-2.5 py-1.5 text-left font-medium">{children}</th>,
  td: ({ children }) => <td className="border-b border-border px-2.5 py-1.5 align-top last:border-b-0">{children}</td>,
};
