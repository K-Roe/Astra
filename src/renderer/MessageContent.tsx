import { splitMessage } from '../shared/messageFormatting';

interface MessageContentProps {
  readonly content: string;
}

/** Minimal text formatter: fenced code and inline code are rendered as text, never HTML. */
export function MessageContent({ content }: MessageContentProps) {
  const blocks = splitMessage(content);

  return <div className="message-content">{blocks.map((block, index) => block.kind === 'code'
    ? <div className="code-block" key={index}>{block.language && <div className="code-language">{block.language}</div>}<pre><code>{block.value}</code></pre></div>
    : <p className="message-text" key={index}>{block.value.split(/(`[^`\n]+`)/g).map((part, partIndex) => part.startsWith('`') && part.endsWith('`') ? <code className="inline-code" key={partIndex}>{part.slice(1, -1)}</code> : part)}</p>)}</div>;
}
