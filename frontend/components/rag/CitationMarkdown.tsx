"use client";

import {
  Children,
  Fragment,
  cloneElement,
  isValidElement,
  type ComponentProps,
  type ReactNode,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

const CITE_RE = /\[(\d{1,2})\]/g;

interface CitationMarkdownProps {
  content: string;
  onCite?: (n: number) => void;
  className?: string;
}

function CiteButton({ n, onCite }: { n: number; onCite?: (n: number) => void }) {
  return (
    <button
      type="button"
      onClick={() => onCite?.(n)}
      aria-label={`定位引用来源 ${n}`}
      title={`定位引用来源 ${n}`}
      className="mx-0.5 inline-flex size-4 items-center justify-center rounded-full align-super text-[10px] font-semibold leading-none text-[var(--accent)] bg-[var(--accent-light)] ring-1 ring-inset ring-[var(--accent)]/20 transition-colors hover:bg-[var(--accent)] hover:text-white focus-visible:ring-2"
    >
      {n}
    </button>
  );
}

function renderText(text: string, onCite?: (n: number) => void): ReactNode {
  const parts = text.split(CITE_RE);
  if (parts.length === 1) return text;
  return parts.map((part, i) => {
    if (i % 2 === 1) {
      return <CiteButton key={i} n={Number(part)} onCite={onCite} />;
    }
    return part ? <Fragment key={i}>{part}</Fragment> : null;
  });
}

/** Recursively convert `[n]` text spans into citation buttons, skipping code/link nodes. */
function processInline(node: ReactNode, onCite?: (n: number) => void): ReactNode {
  return Children.map(node, (child) => {
    if (typeof child === "string") return renderText(child, onCite);
    if (isValidElement(child)) {
      const type = child.type as unknown;
      if (type === "code" || type === "pre" || type === "a") return child;
      const grandChildren = (child.props as { children?: ReactNode }).children;
      if (grandChildren == null) return child;
      return cloneElement(child, {}, processInline(grandChildren, onCite));
    }
    return child;
  });
}

export default function CitationMarkdown({ content, onCite, className }: CitationMarkdownProps) {
  const block = (children: ReactNode, extra?: string) => (
    <span className={extra}>{processInline(children, onCite)}</span>
  );

  return (
    <div className={cn("rag-markdown text-[13px] leading-relaxed text-[var(--text-primary)]", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre: ({ children }) => {
            const codeEl = children as { props?: { className?: string; children?: string } };
            const className = codeEl?.props?.className || "";
            const value = String(codeEl?.props?.children || "");
            const lang = className.match(/language-(\w+)/)?.[1];
            return (
              <div className="my-3 overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)]">
                {lang && (
                  <div className="flex items-center justify-between border-b border-[var(--border-default)] px-3 py-1.5">
                    <span className="font-mono text-[10px] uppercase tracking-wide text-[var(--text-tertiary)]">{lang}</span>
                  </div>
                )}
                <pre className="overflow-x-auto p-3 font-mono text-[12px] leading-relaxed text-[var(--text-secondary)]">
                  <code>{value}</code>
                </pre>
              </div>
            );
          },
          code: ({ children, ...props }: ComponentProps<"code">) => (
            <code
              className="rounded-md bg-[var(--secondary)] px-1.5 py-0.5 font-mono text-[0.85em] text-[var(--text-primary)]"
              {...props}
            >
              {children}
            </code>
          ),
          table: ({ children }) => (
            <div className="my-3 overflow-x-auto rounded-lg border border-[var(--border-default)]">
              <table className="w-full border-collapse text-[12px]">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border-b border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-2 text-left font-semibold text-[var(--text-secondary)]">
              {block(children)}
            </th>
          ),
          td: ({ children }) => (
            <td className="border-b border-[var(--border-default)]/50 px-3 py-2">{block(children)}</td>
          ),
          a: ({ href, children }) => (
            <a
              href={href}
              target={href?.startsWith("http") ? "_blank" : undefined}
              rel={href?.startsWith("http") ? "noopener noreferrer" : undefined}
              className="underline underline-offset-2 text-[var(--accent)]"
            >
              {children}
            </a>
          ),
          p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{block(children)}</p>,
          h1: ({ children }) => <h1 className="mb-2 mt-4 text-lg font-bold first:mt-0">{block(children)}</h1>,
          h2: ({ children }) => <h2 className="mb-2 mt-4 text-base font-semibold">{block(children)}</h2>,
          h3: ({ children }) => <h3 className="mb-1.5 mt-3 text-sm font-semibold">{block(children)}</h3>,
          ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
          li: ({ children }) => <li>{block(children)}</li>,
          blockquote: ({ children }) => (
            <blockquote className="my-3 border-l-[3px] border-[var(--accent)]/40 pl-4 text-[var(--text-secondary)]">
              {block(children)}
            </blockquote>
          ),
          hr: () => <hr className="my-4 border-[var(--border-default)]" />,
          strong: ({ children }) => <strong className="font-semibold">{block(children)}</strong>,
          em: ({ children }) => <em>{block(children)}</em>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}