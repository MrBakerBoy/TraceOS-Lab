"use client";

import { type ComponentProps } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import CodeBlock from "./CodeBlock";
import { useChatTheme } from "@/hooks/useChatTheme";
import { cn } from "@/lib/utils";

type MarkdownRendererProps = {
  children: string;
  className?: string;
};

export default function MarkdownRenderer({ children, className }: MarkdownRendererProps) {
  const theme = useChatTheme();

  /** Inline code pill — uses theme accent */
  function InlineCode({ children: codeChildren, ...props }: ComponentProps<"code">) {
    const isInline = !(props as { node?: { type?: string } }).node?.type?.includes("code") ||
      !String(codeChildren).includes("\n");

    if (!isInline) return <code {...props}>{codeChildren}</code>;

    return (
      <code
        className="px-1.5 py-0.5 rounded-md text-[0.85em] font-medium"
        style={{
          background: theme.inlineCodeBg,
          color: theme.inlineCodeText,
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        }}
        {...props}
      >
        {codeChildren}
      </code>
    );
  }

  /** Code block wrapper — delegates to CodeBlock */
  function PreBlock({ children: preChildren, ...props }: ComponentProps<"pre">) {
    const child = preChildren as { props?: { className?: string; children?: string } };
    const className = child?.props?.className || "";
    const codeValue = child?.props?.children || "";
    const langMatch = className.match(/language-(\w+)/);
    const language = langMatch ? langMatch[1] : undefined;

    if (!codeValue) return <pre {...props}>{preChildren}</pre>;
    return <CodeBlock language={language} value={String(codeValue)} />;
  }

  /** External link with accent color */
  function AnchorLink({ href, children: aChildren, ...props }: ComponentProps<"a">) {
    const isExternal = href?.startsWith("http");
    return (
      <a
        href={href}
        target={isExternal ? "_blank" : undefined}
        rel={isExternal ? "noopener noreferrer" : undefined}
        className="underline underline-offset-2 transition-colors"
        style={{ color: theme.accent, textDecorationColor: `${theme.accent}50` }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.textDecorationColor = theme.accent; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.textDecorationColor = `${theme.accent}50`; }}
        {...props}
      >
        {aChildren}
        {isExternal && <span className="inline-block ml-0.5 text-[0.7em] opacity-50">↗</span>}
      </a>
    );
  }

  /** Table wrapper */
  function TableWrapper({ children: tblChildren, ...props }: ComponentProps<"table">) {
    return (
      <div className="overflow-x-auto my-3 rounded-lg border" style={{ borderColor: theme.divider }}>
        <table className="w-full text-[12px] border-collapse" {...props}>
          {tblChildren}
        </table>
      </div>
    );
  }

  function TableHead({ children: thChildren, ...props }: ComponentProps<"th">) {
    return (
      <th className="px-3 py-2 text-left font-semibold border-b first:pl-4 last:pr-4"
        style={{ color: theme.textSecondary, background: `${theme.divider}30`, borderColor: theme.divider }}
        {...props}>
        {thChildren}
      </th>
    );
  }

  function TableCell({ children: tdChildren, ...props }: ComponentProps<"td">) {
    return (
      <td className="px-3 py-2 border-b first:pl-4 last:pr-4" style={{ borderColor: `${theme.divider}50` }} {...props}>
        {tdChildren}
      </td>
    );
  }

  return (
    <div className={cn("ai-markdown", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre: PreBlock,
          code: InlineCode,
          a: AnchorLink,
          table: TableWrapper,
          th: TableHead,
          td: TableCell,
          h1: ({ children: h1C, ...p }) => <h1 className="text-lg font-bold mt-6 mb-3 first:mt-0" style={{ color: theme.textPrimary }} {...p}>{h1C}</h1>,
          h2: ({ children: h2C, ...p }) => <h2 className="text-base font-semibold mt-5 mb-2" style={{ color: `${theme.textPrimary}e6` }} {...p}>{h2C}</h2>,
          h3: ({ children: h3C, ...p }) => <h3 className="text-sm font-semibold mt-4 mb-1.5" style={{ color: `${theme.textPrimary}cc` }} {...p}>{h3C}</h3>,
          p: ({ children: pC, ...p }) => <p className="my-2 leading-relaxed text-[13px] first:mt-0 last:mb-0" {...p}>{pC}</p>,
          ul: ({ children: ulC, ...p }) => <ul className="pl-5 my-2 list-disc space-y-1" {...p}>{ulC}</ul>,
          ol: ({ children: olC, ...p }) => <ol className="pl-5 my-2 list-decimal space-y-1" {...p}>{olC}</ol>,
          li: ({ children: liC, ...p }) => <li className="text-[13px] leading-relaxed" {...p}>{liC}</li>,
          blockquote: ({ children: bqC, ...p }) => (
            <blockquote className="pl-4 my-3 italic text-[13px]" style={{ borderLeft: `3px solid ${theme.accent}60`, color: theme.textSecondary }} {...p}>
              {bqC}
            </blockquote>
          ),
          hr: (p) => <hr className="my-4" style={{ borderColor: `${theme.divider}50` }} {...p} />,
          strong: ({ children: sC, ...p }) => <strong className="font-semibold" style={{ color: `${theme.textPrimary}e6` }} {...p}>{sC}</strong>,
        }}
      >
        {children}
      </ReactMarkdown>
      <style jsx global>{`
        .ai-markdown :first-child { margin-top: 0 !important; }
        .ai-markdown :last-child { margin-bottom: 0 !important; }
      `}</style>
    </div>
  );
}