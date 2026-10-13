export interface MessageBlock {
  readonly kind: 'text' | 'code';
  readonly value: string;
  readonly language?: string;
}

/** Recognizes complete fenced code blocks; unmatched fences stay visible as plain text. */
export function splitMessage(content: string): MessageBlock[] {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const blocks: MessageBlock[] = [];
  let textLines: string[] = [];
  let codeLines: string[] = [];
  let language = '';
  let insideCode = false;

  const flushText = () => {
    if (textLines.length) blocks.push({ kind: 'text', value: textLines.join('\n') });
    textLines = [];
  };

  for (const line of lines) {
    const fence = /^```([\w+#.-]*)\s*$/.exec(line.trim());
    if (fence && !insideCode) {
      flushText();
      insideCode = true;
      language = fence[1];
      codeLines = [];
    } else if (fence && insideCode) {
      blocks.push({ kind: 'code', value: codeLines.join('\n'), language });
      insideCode = false;
      language = '';
      codeLines = [];
    } else if (insideCode) {
      codeLines.push(line);
    } else {
      textLines.push(line);
    }
  }

  if (insideCode) textLines.push(`\`\`\`${language}`, ...codeLines);
  flushText();
  return blocks;
}
