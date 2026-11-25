"use client";

import { useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Copy } from "lucide-react";

function CodeBlock({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  const langMatch = /language-([\w-]+)/.exec(className || "");
  const language = langMatch?.[1] || "code";
  const rawCode = String(children).replace(/\n$/, "");

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(rawCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignore
    }
  };

  return (
    <div className="my-2.5 overflow-hidden rounded-xl border border-slate-700/70 bg-[#0b1120]">
      <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900/90 px-3 py-1.5 text-xs text-slate-400">
        <span className="font-mono uppercase tracking-wider">{language}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1 rounded-md px-2 py-0.5 text-slate-300 transition hover:bg-slate-800 hover:text-white"
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5 text-emerald-400" />
              <span className="text-emerald-400">Copiado</span>
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" />
              <span>Copiar</span>
            </>
          )}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 text-[13px] leading-relaxed font-mono text-slate-100">
        <code>{rawCode}</code>
      </pre>
    </div>
  );
}

export function MarkdownRenderer({ content }: { content: string }) {
  return (
    <div className="chat-markdown text-[15px] text-slate-100">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ className, children, ...props }) {
            const isBlock = Boolean(className) || String(children).includes("\n");
            if (isBlock) {
              return <CodeBlock className={className}>{children}</CodeBlock>;
            }
            return (
              <code
                className="rounded-md bg-slate-800/90 px-1.5 py-0.5 font-mono text-[13px] text-sky-300"
                {...props}
              >
                {children}
              </code>
            );
          },
          pre({ children }) {
            return <>{children}</>;
          },
          table({ children }) {
            return (
              <div className="my-2.5 overflow-x-auto rounded-lg">
                <table>{children}</table>
              </div>
            );
          },
          a({ href, children }) {
            return (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
