'use client';
import { useState } from 'react';
import { highlight } from 'sugar-high';
import b from './bug.module.css';

export function CodeBlock({ code, filename, downloadHref }: { code: string; filename: string; downloadHref?: string }) {
  const [copied, setCopied] = useState<'idle' | 'copied' | 'failed'>('idle');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied('copied');
    } catch {
      setCopied('failed');
    }
    setTimeout(() => setCopied('idle'), 1500);
  };
  const lines = highlight(code).split('\n');
  return (
    <figure className={b.code}>
      <figcaption>
        <span className="mono">{filename}</span>
        <span className={b.codeActions}>
          {downloadHref && (
            <a className="btn btn-ghost" href={downloadHref} download={filename}>
              Download
            </a>
          )}
          <button className="btn" onClick={copy}>
            {copied === 'copied' ? 'Copied' : copied === 'failed' ? 'Select and copy' : 'Copy'}
          </button>
        </span>
      </figcaption>
      <pre className="code">
        <code>
          {lines.map((l, i) => (
            <span key={i} className={b.line}>
              <span className={b.ln}>{i + 1}</span>
              <span dangerouslySetInnerHTML={{ __html: l || ' ' }} />
            </span>
          ))}
        </code>
      </pre>
    </figure>
  );
}
