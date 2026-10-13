/**
 * Readable-text extraction from fetched HTML.
 *
 * Deliberately conservative and dependency-free. Everything it returns is
 * untrusted data: it may contain hostile text, and callers must never treat it
 * as an instruction. Script, style, template and event-handler content is
 * removed rather than escaped, so nothing executable survives.
 */

const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'template', 'svg', 'canvas', 'iframe', 'object', 'embed', 'video', 'audio', 'select', 'textarea']);

const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  mdash: '\u2014', ndash: '\u2013', hellip: '\u2026', rsquo: '\u2019',
  lsquo: '\u2018', ldquo: '\u201c', rdquo: '\u201d', copy: '\u00a9',
  trade: '\u2122', deg: '\u00b0', times: '\u00d7', eacute: '\u00e9', egrave: '\u00e8',
};

export function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    if (body.startsWith('#')) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    const named = ENTITIES[body.toLowerCase()];
    return named ?? match;
  });
}

export interface ExtractedPage {
  readonly title: string;
  readonly text: string;
  readonly links: readonly { readonly href: string; readonly text: string }[];
}

/**
 * Extract title, visible text and same-page links.
 *
 * Removes anything that could execute: script/style/template elements,
 * `on*` attributes are never emitted because no attributes are emitted at all,
 * and `javascript:`/`data:` links are dropped.
 */
export function extractReadableText(html: string): ExtractedPage {
  // Drop non-content elements entirely, including their bodies.
  let working = html;
  for (const tag of SKIP_TAGS) {
    working = working.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}>`, 'gi'), ' ');
    working = working.replace(new RegExp(`<${tag}\\b[^>]*/?>`, 'gi'), ' ');
  }
  // Comments and CDATA can hide markup; remove them.
  working = working.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, ' ');

  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = titleMatch ? decodeEntities(titleMatch[1].replace(/<[^>]*>/g, '')).trim() : '';

  // Links must be read from the markup, before tags are flattened to spaces.
  const markup = working;
  const links: { href: string; text: string }[] = [];
  const linkPattern = /<a\b[^>]*href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = linkPattern.exec(markup)) !== null) {
    const href = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '').trim();
    if (!href) continue;
    // Refuse anything that could act rather than point.
    if (/^\s*(javascript|data|vbscript|file):/i.test(href)) continue;
    links.push({ href, text: decodeEntities(match[5].replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim().slice(0, 120) });
  }

  // Residual tags become spaces so words do not run together.
  working = working.replace(/<[^>]*>/g, ' ');

  const text = decodeEntities(working).replace(/[ \t\u00a0]+/g, ' ').replace(/\s*\n\s*/g, '\n')
    .replace(/\n{3,}/g, '\n\n').trim();

  return { title, text, links };
}

const CHUNK_TARGET_CHARS = 900;
const CHUNK_OVERLAP_CHARS = 120;

/**
 * Split text into overlapping chunks on paragraph then sentence boundaries.
 * Overlap keeps a citation's context readable when it is shown alone.
 */
export function chunkText(text: string, targetChars = CHUNK_TARGET_CHARS, overlapChars = CHUNK_OVERLAP_CHARS): string[] {
  const cleaned = text.replace(/\r\n/g, '\n').trim();
  if (!cleaned) return [];
  const paragraphs = cleaned.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = '';

  const flush = () => {
    if (current.trim()) chunks.push(current.trim());
    current = '';
  };

  for (const paragraph of paragraphs) {
    // Very long paragraphs are split on sentence boundaries first.
    const sentences = paragraph.length > targetChars ? paragraph.split(/(?<=[.!?])\s+/) : [paragraph];
    for (const sentence of sentences) {
      if (current.length + sentence.length + 1 <= targetChars) {
        current = current ? `${current}\n\n${sentence}` : sentence;
        continue;
      }
      flush();
      if (sentence.length <= targetChars) {
        current = sentence;
        continue;
      }
      // A single sentence longer than the budget is cut on word boundaries.
      let rest = sentence;
      while (rest.length > targetChars) {
        let cut = rest.lastIndexOf(' ', targetChars);
        if (cut <= 0) cut = targetChars;
        chunks.push(rest.slice(0, cut).trim());
        rest = rest.slice(cut).trim();
      }
      current = rest;
    }
  }
  flush();

  if (chunks.length < 2 || overlapChars <= 0) return chunks;
  const withOverlap = chunks.map((chunk, index) => {
    if (index === 0) return chunk;
    const previous = chunks[index - 1];
    const tail = previous.slice(-overlapChars);
    return /[a-z0-9]$/i.test(tail) && /^[a-z0-9]/i.test(chunk) ? `${tail} ${chunk}` : `${tail}\n\n${chunk}`;
  });
  return withOverlap;
}