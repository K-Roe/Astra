import type { PersonalMemoryService } from './personalMemory';
import { detectMemoryIntent, suggestMemory, type MemoryIntent } from './memoryIntents';

/**
 * Executes Karl's explicit memory instructions against the local database.
 *
 * The language model is never asked to produce a database command. This service
 * parses only the text Karl typed, validates it, and performs the operation
 * itself. Replies are built from real rows, so Astra can never claim she
 * remembered something she did not, and a failure is reported as a failure.
 */

export interface MemoryCommandResult {
  /** True when Astra answered from memory and the model was not consulted. */
  readonly handled: boolean;
  readonly reply?: string;
  /** A suggested memory Karl has not accepted yet. Nothing is stored for it. */
  readonly suggestion?: { readonly text: string; readonly subject: string };
  readonly action?: 'remembered' | 'updated' | 'forgot' | 'recalled' | 'conversation_forgotten' | 'explained' | 'suggested';
  readonly ok?: boolean;
}

export interface MemoryCommandOptions {
  /** Conversation reference used if a memory is saved from this conversation. */
  readonly conversationRef?: string;
  /** Suggestions can be switched off entirely by Karl. */
  readonly suggestionsEnabled?: boolean;
}

/** Targets too vague to act on safely. */
const GENERIC_TARGETS = new Set(['that', 'this', 'it', 'information', 'info', 'everything', 'all', 'memory', 'memories', 'that information', 'this information']);

export class MemoryCommands {
  constructor(private readonly memory: PersonalMemoryService) {}

  /**
   * Handle a message from Karl. `origin` must be the trusted chat path: only
   * text typed by Karl reaches here, never scraped or repository content.
   */
  handle(text: string, options: MemoryCommandOptions = {}): MemoryCommandResult {
    const intent = detectMemoryIntent(text);
    if (intent) return this.run(intent, options);
    if (options.suggestionsEnabled === false) return { handled: false };
    const suggestion = suggestMemory(text);
    if (!suggestion) return { handled: false };
    if (this.memory.relevant(suggestion.text, 3).some((memory) => sameClaim(memory.statement, suggestion.text))) {
      return { handled: false };
    }
    return { handled: false, suggestion };
  }

  private run(intent: MemoryIntent, options: MemoryCommandOptions): MemoryCommandResult {
    try {
      switch (intent.kind) {
        case 'explain_persistence': {
          const count = this.memory.summary().count;
          return {
            handled: true,
            action: 'explained',
            ok: true,
            reply: `This conversation is temporary and will not be available after Astra closes. Personal memory persists across restarts, but I save information only when you explicitly ask me to remember it or confirm a suggestion. You currently have ${count} saved personal memor${count === 1 ? 'y' : 'ies'}. Asking this question did not save anything.`,
          };
        }
        case 'remember': {
          const record = this.memory.remember({
            statement: intent.text,
            subject: intent.subject,
            origin: 'user_stated',
            conversationRef: options.conversationRef ?? null,
          });
          return {
            handled: true,
            action: 'remembered',
            ok: true,
            reply: `Saved. I'll keep that in mind: "${record.statement}"\n(Stored as ${record.category.replace('_', ' ')}, ${record.id}. You can ask me to update or forget it at any time.)`,
          };
        }
        case 'update': {
          const record = this.memory.remember({
            statement: intent.text,
            subject: intent.subject,
            origin: 'user_correction',
            correction: true,
            conversationRef: options.conversationRef ?? null,
          });
          const replaced = this.memory.listAll().filter((memory) => memory.status === 'superseded').at(-1);
          return {
            handled: true,
            action: 'updated',
            ok: true,
            reply: `Updated. The active note now reads: "${record.statement}"\n${replaced ? `It replaces the earlier note "${replaced.statement}", which is marked superseded rather than deleted. ` : ''}You can ask me to forget it at any time.`,
          };
        }
        case 'forget': {
          const target = intent.text.replace(/[.!?]+$/, '').trim();
          if (!target || GENERIC_TARGETS.has(target.toLowerCase())) {
            // "forget that" is not specific enough to delete anything. Asking is
            // safer than guessing which fact Karl meant.
            return {
              handled: true,
              action: 'forgot',
              ok: false,
              reply: 'Tell me what to forget, for example "forget my frontend preference". I have not changed anything.',
            };
          }
          const removed = this.memory.forgetByText(target);
          if (removed.length === 0) {
            return { handled: true, action: 'forgot', ok: true, reply: 'There was nothing active to forget.' };
          }
          return {
            handled: true,
            action: 'forgot',
            ok: true,
            reply: `Forgotten. I removed ${removed.length} memory record(s) and will not use ${removed.length === 1 ? 'it' : 'them'} in future answers.\n${removed.map((memory) => `- ${memory.category.replace('_', ' ')}: ${memory.statement || '(text cleared)'}`).join('\n')}`,
          };
        }
        case 'forget_conversation': {
          const ref = options.conversationRef;
          const count = ref ? this.memory.forgetConversation(ref) : 0;
          return {
            handled: true,
            action: 'conversation_forgotten',
            ok: true,
            reply: count > 0
              ? `I will not keep anything from this conversation: ${count} record(s) forgotten.`
              : 'I had not saved anything from this conversation, so there was nothing to forget.',
          };
        }
        case 'recall': {
          let found = this.memory.relevant(intent.text, 8);
          let fallback = false;
          if (found.length === 0) {
            // Nothing matched the topic by keyword. Rather than claim she has no
            // memory at all, she shows everything she has been told and says the
            // topic did not match, which is honest and still useful.
            const all = this.memory.listActive(8);
            if (all.length === 0) {
              return {
                handled: true,
                action: 'recalled',
                ok: true,
                reply: 'I have no stored memory about that. I only use what you have told me directly, so I will not guess.',
              };
            }
            found = all;
            fallback = true;
          }
          return {
            handled: true,
            action: 'recalled',
            ok: true,
            reply: `${fallback ? `Nothing I have saved matches "${intent.text}", but here is everything you have told me so far` : `Here is what you told me`} (${found.length} record${found.length === 1 ? '' : 's'}):\n${found
              .map((memory) => `- [${memory.category.replace('_', ' ')}] ${memory.statement} (saved ${memory.createdAt.slice(0, 10)})`)
              .join('\n')}`,
          };
        }
        default:
          return { handled: false };
      }
    } catch (error) {
      // A failure must be reported as a failure, never smoothed over.
      return {
        handled: true,
        action: undefined,
        ok: false,
        reply: `I could not do that: ${error instanceof Error ? error.message : 'unknown memory error'}. Nothing was changed.`,
      };
    }
  }

}

function sameClaim(a: string, b: string): boolean {
  const normalise = (value: string): string => value.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).sort().join(' ');
  return normalise(a) === normalise(b);
}
