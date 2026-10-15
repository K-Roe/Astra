/**
 * Deterministic parsing of Karl's natural-language memory instructions.
 *
 * This module is pure and has no database or model access. It decides only
 * *whether* a message is an explicit memory instruction and what the intended
 * operation is. Nothing the language model produces is ever treated as a
 * command: a model reply can describe a memory, but only text Karl typed in the
 * chat box reaches this parser, and a trusted service still validates and
 * executes whatever is returned here.
 */

export type MemoryIntentKind = 'remember' | 'recall' | 'update' | 'forget' | 'forget_conversation' | 'explain_persistence';

export interface MemoryIntent {
  readonly kind: MemoryIntentKind;
  /** What Karl asked her to store, or the topic he asked about. */
  readonly text: string;
  /** A stable subject such as `preference.frontend_stack`, when one is clear. */
  readonly subject?: string;
}

/** Phrases that mean "store this". Deliberately narrow to avoid surprises. */
const REMEMBER = /^\s*(?:please\s+)?(?:remember|note down|keep in mind|don'?t forget)\b\s*(?:that\s+|this\s*:?\s*)?/i;
/** A question about memory is not an instruction to store anything. */
const QUESTION = /^(?:will|would|can|could|do|does|did|are|is|have|has)\s+(?:you|i|we)\b/i;
const RECALL = /\b(?:what do you remember|what have i told you|what did i tell you|do you remember|what do you know about me|recall)\b/i;
const RECALL_TOPIC = /\bwhat (?:do|did) you (?:remember|know|tell me)?\s*(?:me\s*)?about\s+(.+)$/i;
const FORGET = /\b(?:forget|stop remembering|delete|remove|drop)\b\s*(?:that\s+|my\s+|the\s+|about\s+|this\s*:?\s*)?(.*)$/i;
const FORGET_CONFIRM = /\bforget\s+(?:that|this|it)\b/i;
const UPDATE = /\b(?:update|change|correct|fix)\s+(?:my|your)\s+([\w ]{2,40}?)\s+to\b\s+(.+)$/i;
const UPDATE_ALTERNATIVE = /^\s*(?:actually|no,?|correction)[:,]?\s+(?:i|it)\s+(.+)$/i;
const NO_MEMORY = /\b(?:don'?t|do not|never)\s+(?:remember|save|store)\s+(?:this|that|our)\s+conversation\b/i;
const NO_MEMORY_SHORT = /\bno need to remember (?:this|that)\b/i;

/** Word-ish subject key: `preference.frontend_stack`. */
export function subjectFor(text: string, hint?: string): string {
  const words = (hint ?? text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word))
    .slice(0, 4);
  return words.length > 0 ? `preference.${words.join('_')}` : 'preference.general';
}

const STOP_WORDS = new Set([
  'the', 'and', 'that', 'this', 'with', 'from', 'into', 'your', 'you', 'are', 'was',
  'please', 'always', 'never', 'want', 'need', 'like', 'prefer', 'prefers',
  'remember', 'forget', 'should', 'would', 'have', 'been', 'them', 'they',
]);

/**
 * Detect an explicit memory instruction.
 *
 * Returns `null` for ordinary conversation. Detection is intentionally
 * conservative: an ambiguous sentence must not silently write to the database.
 */
/** "Astra, remember that ..." and similar vocatives carry no instruction. */
const LEAD = /^\s*(?:(?:hey|hi|ok|okay|please|astra)\b[,:]?\s*)+/i;

export function detectMemoryIntent(raw: string): MemoryIntent | null {
  const text = raw.replace(LEAD, '').trim();
  if (!text || raw.length > 2000) return null;

  // Questions about Astra's own persistence must be answered from the real
  // service, never from an unrelated retrieved website or a generated claim.
  if (/^(?:will|would)\s+you\s+remember\b/i.test(text)
    || (/^(?:can|could)\s+you\s+remember\b/i.test(text) && /\b(?:after|across|when)\b.*\b(?:close|restart|reopen|quit|exit|session)\b/i.test(text))
    || /^how\s+(?:does|do|is)\s+(?:your|personal)\s+memory\b/i.test(text)) {
    return { kind: 'explain_persistence', text };
  }

  if (NO_MEMORY.test(text) || NO_MEMORY_SHORT.test(text)) {
    return { kind: 'forget_conversation', text };
  }

  // Explicit update before recall, so "update what you remember about X" is an
  // update rather than a question.
  const update = UPDATE.exec(text);
  if (update) {
    const [, topic, value] = update;
    return { kind: 'update', subject: subjectFor(value, topic), text: value.trim() };
  }

  if (FORGET_CONFIRM.test(text) || /^(?:forget|stop remembering)\b/i.test(text)) {
    const raw = FORGET.exec(text)?.[1]?.trim() ?? '';
    // "forget my frontend preference" names a subject, not the word preference.
    const target = raw
      .replace(/^(?:what|which)\s+(?:i|you|we)\s+(?:told|said|know|mentioned)\s+(?:me|you|us)?\s*(?:about|regarding|on)?\s*/i, '')
      .replace(/^(?:my|the|that|this|our)\s+/i, '')
      .replace(/\s+(?:preference|preferences|memory|memories|note|notes|facts?)\b.*$/i, '')
      .trim();
    return { kind: 'forget', text: target, subject: target ? subjectFor(target, target) : undefined };
  }

  const recalled = RECALL_TOPIC.exec(text);
  if (RECALL.test(text) || recalled) {
    // Keep the topic, not the whole question: retrieval works better on the
    // subject Karl actually asked about.
    const topic = (recalled?.[1] ?? text)
      .replace(/^\s*what\s+(?:do|did)\s+(?:you|i)\s+.*?(?:about|on|regarding)\s+/i, '')
      .replace(/^\s*(?:do|does)\s+you\s+(?:remember|know)\s+(?:about\s+|that\s+)?/i, '')
      .replace(/\?\s*$/, '')
      .trim();
    return { kind: 'recall', text: topic || text };
  }

  const alternative = UPDATE_ALTERNATIVE.exec(text);
  if (alternative && /\b(?:prefer|use|want|like|always|never)\b/i.test(alternative[1])) {
    return { kind: 'update', subject: subjectFor(alternative[1]), text: alternative[1].trim() };
  }

  // Only an imperative counts. "Will you remember this?" asks a question and
  // must never write to the database.
  if (REMEMBER.test(text) && !QUESTION.test(text)) {
    const statement = text.replace(REMEMBER, '').replace(/^[:,]\s*/, '').trim();
    if (statement.length >= 3 && !QUESTION.test(statement)) {
      return { kind: 'remember', text: statement, subject: subjectFor(statement) };
    }
  }

  return null;
}

/**
 * A stable, explicit statement that is probably worth remembering.
 *
 * Suggestions are never stored automatically: the caller surfaces this to Karl,
 * who must accept it. Research content and repository text never reach here
 * because the caller only ever passes Karl's own chat message.
 */
export function suggestMemory(text: string): { readonly text: string; readonly subject: string } | null {
  const trimmed = text.trim();
  if (trimmed.length < 8 || trimmed.length > 400) return null;
  const statement = /(?:^|[.!?]\s+)([^.!?]*\b(?:i prefer|i always|i never|i use|i want|i need|i like|from now on|going forward|always use|never use)\b[^.!?]*)/i.exec(trimmed)?.[1]?.trim();
  if (!statement || statement.length < 8) return null;
  if (/(secret|password|token|api key|credential|private key)/i.test(statement)) return null;
  return { text: statement, subject: subjectFor(statement) };
}
