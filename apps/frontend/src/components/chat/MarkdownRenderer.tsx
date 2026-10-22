'use client';

import React, { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface MarkdownRendererProps {
  content: string;
  onCitationClick?: (evidenceId: string) => void;
  className?: string;
}

interface CodeBlockProps {
  code: string;
  language?: string;
}

function CodeBlock({ code, language }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard access denied
    }
  };

  return (
    <div className="relative group my-3 rounded-lg overflow-hidden border border-subtle bg-slate-900 text-slate-100 font-mono text-xs">
      <div className="flex items-center justify-between px-3.5 py-1.5 bg-slate-800/80 border-b border-slate-700/60 text-slate-400 select-none">
        <span className="text-[11px] font-medium tracking-wide uppercase">
          {language || 'code'}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          aria-label="Copy code to clipboard"
          className="flex items-center gap-1 text-[11px] hover:text-slate-200 transition-colors py-0.5 px-1.5 rounded hover:bg-slate-700/60"
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-emerald-400 font-medium">Copied</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <pre className="p-3.5 overflow-x-auto leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}

/**
 * Parses inline formatting: bold (**), italic (*), inline code (`), and citation tags ([S1])
 */
function renderInlineFormattedText(
  text: string,
  onCitationClick?: (evidenceId: string) => void
): React.ReactNode[] {
  // Regex matches:
  // 1. Citations: \[(S\d+)\]
  // 2. Inline code: `([^`]+)`
  // 3. Bold: \*\*([^*]+)\*\*
  // 4. Italic: \*([^*]+)\*
  const pattern = /(\[(?:S\d+)\]|`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;
  const parts = text.split(pattern);

  return parts.map((part, index) => {
    if (!part) return null;

    // Citation tag match: [S1]
    const citationMatch = part.match(/^\[(S\d+)\]$/);
    if (citationMatch) {
      const evidenceId = citationMatch[1];
      return (
        <button
          key={`cit-${index}-${evidenceId}`}
          type="button"
          onClick={() => onCitationClick?.(evidenceId)}
          title={`View citation evidence ${evidenceId}`}
          aria-label={`View citation source ${evidenceId}`}
          className="inline-flex items-center justify-center px-1.5 py-0.5 mx-0.5 rounded text-[11px] font-semibold bg-brand-primary/10 text-brand-primary hover:bg-brand-primary/20 active:scale-95 transition-all cursor-pointer select-none align-baseline border border-brand-primary/20"
        >
          {evidenceId}
        </button>
      );
    }

    // Inline code: `foo`
    if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
      return (
        <code
          key={`code-${index}`}
          className="px-1.5 py-0.5 mx-0.5 rounded text-xs font-mono bg-surface-elevated border border-subtle text-brand-primary font-medium"
        >
          {part.slice(1, -1)}
        </code>
      );
    }

    // Bold text: **bold**
    if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
      return (
        <strong key={`bold-${index}`} className="font-semibold text-primary">
          {renderInlineFormattedText(part.slice(2, -2), onCitationClick)}
        </strong>
      );
    }

    // Italic text: *italic*
    if (part.startsWith('*') && part.endsWith('*') && part.length >= 2) {
      return (
        <em key={`italic-${index}`} className="italic text-secondary">
          {renderInlineFormattedText(part.slice(1, -1), onCitationClick)}
        </em>
      );
    }

    // Regular plain text
    return <React.Fragment key={`text-${index}`}>{part}</React.Fragment>;
  });
}

/**
 * Safe, zero-vulnerability Markdown renderer implemented entirely with React elements.
 * Strictly avoids dangerouslySetInnerHTML to guarantee complete immunity against XSS.
 */
export function MarkdownRenderer({
  content,
  onCitationClick,
  className,
}: MarkdownRendererProps) {
  if (!content) return null;

  // Split content into code blocks and normal text blocks
  const tokens: Array<{ type: 'code' | 'text'; content: string; language?: string }> = [];
  const lines = content.split('\n');

  let inCodeBlock = false;
  let codeBuffer: string[] = [];
  let codeLang = '';
  let textBuffer: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.trim().startsWith('```')) {
      if (inCodeBlock) {
        // Closing code block
        tokens.push({
          type: 'code',
          content: codeBuffer.join('\n'),
          language: codeLang,
        });
        codeBuffer = [];
        codeLang = '';
        inCodeBlock = false;
      } else {
        // Opening code block
        if (textBuffer.length > 0) {
          tokens.push({ type: 'text', content: textBuffer.join('\n') });
          textBuffer = [];
        }
        codeLang = line.trim().slice(3).trim();
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeBuffer.push(line);
    } else {
      textBuffer.push(line);
    }
  }

  // Handle unclosed code block (e.g. during live streaming)
  if (inCodeBlock && codeBuffer.length > 0) {
    tokens.push({
      type: 'code',
      content: codeBuffer.join('\n'),
      language: codeLang,
    });
  } else if (textBuffer.length > 0) {
    tokens.push({ type: 'text', content: textBuffer.join('\n') });
  }

  return (
    <div className={cn('text-sm text-primary leading-relaxed space-y-2.5 break-words', className)}>
      {tokens.map((token, tokenIdx) => {
        if (token.type === 'code') {
          return (
            <CodeBlock
              key={`codeblock-${tokenIdx}`}
              code={token.content}
              language={token.language}
            />
          );
        }

        // Parse paragraphs, headings, blockquotes, and lists in text token
        const paragraphs = token.content.split(/\n\s*\n/);

        return (
          <React.Fragment key={`token-${tokenIdx}`}>
            {paragraphs.map((para, paraIdx) => {
              const trimmed = para.trim();
              if (!trimmed) return null;

              // Headings
              if (trimmed.startsWith('### ')) {
                return (
                  <h3
                    key={`h3-${paraIdx}`}
                    className="text-base font-semibold text-primary tracking-tight mt-4 mb-2"
                  >
                    {renderInlineFormattedText(trimmed.slice(4), onCitationClick)}
                  </h3>
                );
              }
              if (trimmed.startsWith('## ')) {
                return (
                  <h2
                    key={`h2-${paraIdx}`}
                    className="text-lg font-bold text-primary tracking-tight mt-5 mb-2.5"
                  >
                    {renderInlineFormattedText(trimmed.slice(3), onCitationClick)}
                  </h2>
                );
              }
              if (trimmed.startsWith('# ')) {
                return (
                  <h1
                    key={`h1-${paraIdx}`}
                    className="text-xl font-bold text-primary tracking-tight mt-6 mb-3"
                  >
                    {renderInlineFormattedText(trimmed.slice(2), onCitationClick)}
                  </h1>
                );
              }

              // Blockquotes
              if (trimmed.startsWith('> ')) {
                return (
                  <blockquote
                    key={`quote-${paraIdx}`}
                    className="pl-3.5 border-l-2 border-brand-primary text-secondary italic my-2"
                  >
                    {renderInlineFormattedText(trimmed.slice(2), onCitationClick)}
                  </blockquote>
                );
              }

              // Lists: Bullet (- or *) or Numbered (1.)
              const paraLines = trimmed.split('\n');
              const isBulletList = paraLines.every((l) => /^\s*[-*]\s+/.test(l));
              const isOrderedList = paraLines.every((l) => /^\s*\d+\.\s+/.test(l));

              if (isBulletList) {
                return (
                  <ul key={`ul-${paraIdx}`} className="list-disc pl-5 space-y-1 my-2">
                    {paraLines.map((li, liIdx) => (
                      <li key={`li-${liIdx}`}>
                        {renderInlineFormattedText(li.replace(/^\s*[-*]\s+/, ''), onCitationClick)}
                      </li>
                    ))}
                  </ul>
                );
              }

              if (isOrderedList) {
                return (
                  <ol key={`ol-${paraIdx}`} className="list-decimal pl-5 space-y-1 my-2">
                    {paraLines.map((li, liIdx) => (
                      <li key={`oli-${liIdx}`}>
                        {renderInlineFormattedText(li.replace(/^\s*\d+\.\s+/, ''), onCitationClick)}
                      </li>
                    ))}
                  </ol>
                );
              }

              // Standard Paragraph (with soft breaks preserved)
              return (
                <p key={`p-${paraIdx}`} className="leading-relaxed">
                  {paraLines.map((line, lineIdx) => (
                    <React.Fragment key={`line-${lineIdx}`}>
                      {renderInlineFormattedText(line, onCitationClick)}
                      {lineIdx < paraLines.length - 1 && <br />}
                    </React.Fragment>
                  ))}
                </p>
              );
            })}
          </React.Fragment>
        );
      })}
    </div>
  );
}
