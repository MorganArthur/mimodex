import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export const MarkdownContent = memo(function MarkdownContent({ content }: { content: string }) {
  return (
    <ReactMarkdown
      components={{
        a: ({ children, ...props }) => (
          <a {...props} rel="noreferrer" target="_blank">
            {children}
          </a>
        ),
      }}
      remarkPlugins={[remarkGfm]}
    >
      {content}
    </ReactMarkdown>
  );
});
