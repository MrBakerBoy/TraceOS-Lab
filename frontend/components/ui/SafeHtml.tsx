"use client";

import { useMemo } from "react";
import DOMPurify from "dompurify";

interface SafeHtmlProps {
  html: string;
  className?: string;
  as?: keyof JSX.IntrinsicElements;
}

export default function SafeHtml({ html, className, as: Tag = "div" }: SafeHtmlProps) {
  const clean = useMemo(() => {
    if (typeof window === "undefined") return html;
    return DOMPurify.sanitize(html, {
      ALLOWED_TAGS: [
        "h1", "h2", "h3", "h4", "h5", "h6",
        "p", "br", "hr", "blockquote", "pre", "code",
        "ul", "ol", "li",
        "strong", "em", "s", "u", "a", "span", "div",
        "img", "figure", "figcaption",
        "table", "thead", "tbody", "tr", "th", "td",
      ],
      ALLOWED_ATTR: [
        "href", "target", "rel", "src", "alt", "title",
        "class", "style", "width", "height",
      ],
      ALLOW_DATA_ATTR: false,
    });
  }, [html]);

  return (
    <Tag
      className={className}
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  );
}
