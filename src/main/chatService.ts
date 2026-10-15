import type { ChatMessage, ChatStatus } from '../shared/contracts';
import {
  extractUsedCitations,
  groundingInstruction,
  relevantGrounding,
  referenceBlock,
  type GroundingContext,
} from './knowledge/grounding';
import type { CodingBridge } from './agent/codingBridge';
import type { MemoryCommandResult } from './memory/memoryCommands';
import type { PersonalMemorySummary } from './memory/personalMemory';
import { detectMemoryIntent } from './memory/memoryIntents';

/**
 * The slice of personal memory the chat layer is allowed to use.
 *
 * Deliberately narrow: chat may ask for a bounded context block, may run a
 * validated memory command, and may report the startup summary. It cannot reach
 * the database, the research store or anything privileged.
 */
export interface MemoryChatPort {
  handle(text: string): MemoryCommandResult;
  contextFor(query: string): { relevant: readonly { category: string; statement: string }[]; summary: readonly { category: string; statement: string }[] };
  summary(): PersonalMemorySummary;
  suggestionsEnabled(): boolean;
  conversationRef(): string;
}

export const MODEL_NAME = 'gemma3:4b';
export const MODEL_DIGEST = 'c30276f7dffec93a536d283e15088990454b8d21cf180a3d6eea4959e4147291';
const OLLAMA_URL = 'http://127.0.0.1:11434';
const MAX_MESSAGE_LENGTH = 8000;

interface ModelTag {
  name: string;
  digest: string;
}

interface ModelList {
  models: ModelTag[];
}

interface ModelShow {
  details?: { runner?: string };
}

interface LoadedModels {
  models: Array<{ name: string; digest: string }>;
}

interface OllamaChat {
  message?: { role?: string; content?: string };
}

export class ChatService {
  private readonly history: ChatMessage[] = [];
  private active: AbortController | null = null;
  private codingBusy = false;
  private codingAbort: AbortController | null = null;
  private generation = 0;
  private detail = 'Local model ready. Conversation history is temporary.';
  private memorySuggestion: { text: string; subject: string } | null = null;

  constructor(
    private readonly personality: string,
    private readonly request: typeof fetch = fetch,
    /** Optional retrieval hook; absent means a plain, unsourced conversation. */
    private readonly grounder?: (query: string) => GroundingContext,
    /** Optional coding tool bridge; absent means chat cannot act on repositories. */
    private readonly coding?: CodingBridge,
    /** Optional personal memory port; absent means chat has no memory at all. */
    private readonly memory?: MemoryChatPort,
  ) {
    this.coding?.onActivity((event, snapshot) => {
      if (event.kind === 'task.completed') {
        const last = snapshot.testResults.at(-1);
        this.history.push({ role: 'assistant', content: `Coding task #${snapshot.taskId} completed in ${snapshot.repository}. ${last ? `${snapshot.testResults.filter((result) => result.ok).length}/${snapshot.testResults.length} approved checks passed. ` : 'No executable checks were run. '}${snapshot.diff ? `Git diff: ${snapshot.diff.filesChanged} file(s), +${snapshot.diff.insertions}/-${snapshot.diff.deletions}.` : 'No Git diff was available.'} Review the full diff in Coding.` });
      } else if (event.kind === 'task.failed') {
        this.history.push({ role: 'assistant', content: `Coding task #${snapshot.taskId} failed: ${snapshot.error ?? event.label}. Review the test output and changed files in Coding.` });
      } else if (event.kind === 'plan.correction') {
        this.history.push({ role: 'assistant', content: `The approved check failed. I proposed one bounded correction in the same repository and file scope. Review the revised patch and explicitly approve it before any further edit or command.` });
      }
    });
  }

  private async post<T>(route: string, body: object, signal: AbortSignal): Promise<T> {
    const response = await this.request(`${OLLAMA_URL}${route}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status}.`);
    return await response.json() as T;
  }

  private async get<T>(route: string, signal: AbortSignal): Promise<T> {
    const response = await this.request(`${OLLAMA_URL}${route}`, { signal });
    if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status}.`);
    return await response.json() as T;
  }

  private async verifyModel(signal: AbortSignal): Promise<void> {
    if (!this.personality.trim()) throw new Error('Astra personality configuration is unavailable.');
    const [tags, show] = await Promise.all([
      this.get<ModelList>('/api/tags', signal),
      this.post<ModelShow>('/api/show', { model: MODEL_NAME }, signal),
    ]);
    if (!Array.isArray(tags.models) || !tags.models.some((entry) => entry.name === MODEL_NAME && entry.digest === MODEL_DIGEST) || show.details?.runner !== 'llamacpp') {
      throw new Error('The approved Gemma model digest is unavailable or no longer the default. Chat is paused.');
    }
  }

  private snapshot(state: ChatStatus['state']): ChatStatus {
    let memoryCount = 0;
    let memoryAvailable = false;
    try {
      if (this.memory) {
        memoryCount = this.memory.summary().count;
        memoryAvailable = true;
      }
    } catch {
      // A failed database read is unavailable, even if a port was injected.
    }
    return {
      state,
      detail: this.detail,
      messages: this.history.map((message) => ({ ...message })),
      memorySuggestion: this.memorySuggestion ? { ...this.memorySuggestion } : null,
      memoryCount,
      memoryAvailable,
    };
  }

  async getStatus(): Promise<ChatStatus> {
    try {
      await this.verifyModel(AbortSignal.timeout(5000));
      this.detail = 'Local model ready. Conversation history is temporary.';
      return this.snapshot('ready');
    } catch (error) {
      this.detail = this.describe(error);
      return this.snapshot('error');
    }
  }

  private describe(error: unknown): string {
    if (error instanceof Error && error.message.startsWith('The approved Gemma')) return error.message;
    if (error instanceof Error && error.message.startsWith('Astra personality')) return error.message;
    if (error instanceof Error && error.message === 'The local model returned an empty response.') return error.message;
    if (error instanceof Error && error.message === 'Conversation was cleared.') return error.message;
    if (error instanceof Error && /^Ollama returned HTTP \d{3}\.$/.test(error.message)) return error.message;
    if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) return 'The local model request was cancelled or timed out.';
    return 'Cannot reach the local Ollama service. Start Ollama and try again.';
  }

  async send(content: unknown): Promise<ChatStatus> {
    if (this.active || this.codingBusy) throw new Error('A response is already generating.');
    if (typeof content !== 'string' || !content.trim() || content.length > MAX_MESSAGE_LENGTH) {
      throw new Error(`Enter a message of 1 to ${MAX_MESSAGE_LENGTH} characters.`);
    }
    const text = content.trim();

    // Capability is application state, never a fact inferred by Gemma or a
    // retrieved website. This also works when the memory port is unavailable.
    if (detectMemoryIntent(text)?.kind === 'explain_persistence') {
      let available = false;
      let count = 0;
      try {
        if (this.memory) {
          count = this.memory.summary().count;
          available = true;
        }
      } catch { /* Report the failed service read as unavailable. */ }
      const reply = available
        ? `Yes. I can remember information you ask me to save, even after restarting. Our current conversation history is temporary. You have ${count} saved personal memor${count === 1 ? 'y' : 'ies'}. Asking this question did not save anything.`
        : 'Personal memory is currently unavailable. Our current conversation history is temporary, and I cannot confirm a saved memory until the memory service is available. Asking this question did not save anything.';
      this.history.push({ role: 'user', content: text }, { role: 'assistant', content: reply });
      this.detail = available ? 'Explained personal memory from the local service. Nothing saved.' : 'Personal memory service unavailable. Nothing saved.';
      return this.snapshot('ready');
    }

    // Personal memory is handled before anything else, and by a trusted
    // service rather than the model. Only text Karl typed can reach it.
    if (this.memory) {
      const command = this.memory.handle(text);
      this.memorySuggestion = command.suggestion ? { ...command.suggestion } : null;
      if (command.handled && command.reply) {
        this.history.push({ role: 'user', content: text }, { role: 'assistant', content: command.reply });
        this.detail = command.ok === false
          ? 'That memory request failed and nothing was changed.'
          : describeMemoryAction(command.action);
        return this.snapshot('ready');
      }
    }

    // A coding instruction is handled by real tools, not by the language model.
    // This runs before Ollama so a coding request never becomes a hallucinated
    // description of work that was never done.
    if (this.coding) {
      this.codingBusy = true;
      const codingGeneration = this.generation;
      const codingController = new AbortController();
      this.codingAbort = codingController;
      let toolResult;
      try { toolResult = await this.coding.handle(text, codingController.signal); }
      catch (error) {
        if (!codingController.signal.aborted) throw error;
        if (codingGeneration === this.generation) this.history.push({ role: 'user', content: text }, { role: 'assistant', content: 'Coding investigation cancelled. No plan was approved and no file was changed.' });
        this.detail = 'Coding investigation cancelled.';
        return this.snapshot('ready');
      } finally { this.codingBusy = false; this.codingAbort = null; }
      if (toolResult) {
        this.history.push({ role: 'user', content: text }, { role: 'assistant', content: toolResult.reply });
        this.detail = toolResult.snapshot
          ? `Coding task state: ${toolResult.snapshot.phase}.`
          : 'Local model ready. Nothing in the knowledge base matched, so this reply is not sourced.';
        return this.snapshot('ready');
      }
    }

    const controller = new AbortController();
    this.active = controller;
    const requestGeneration = this.generation;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(120000)]);
    try {
      await this.verifyModel(signal);
      // Retrieval happens before generation so the answer can be grounded in
      // stored sources, and so a question with no stored answer can say so.
      const grounding = relevantGrounding(text, this.grounder
        ? this.grounder(text)
        : { passages: [], memories: [], hasKnowledge: false, stalePassages: 0 });
      const reference = referenceBlock(grounding);
      const guidance = groundingInstruction(grounding);
      // Personal memory is injected separately from researched knowledge so the
      // model can never present a website passage as something Karl said.
      const memoryBlock = this.memory ? memoryPromptBlock(this.memory, text) : '';
      const memoryStatus = this.snapshot('ready');
      const capability = memoryStatus.memoryAvailable
        ? `Runtime capability: persistent personal memory is available, with ${memoryStatus.memoryCount} saved record(s). Conversation history is temporary. A memory exists only after the trusted service confirms a write. Never claim to have saved, changed or forgotten a memory in a generated reply.`
        : 'Runtime capability: persistent personal memory is unavailable. Conversation history is temporary. Never claim to have saved, changed or forgotten a memory in a generated reply.';

      const systemPrompt = [
        `You are Astra, a local-first desktop companion. Follow this authored personality specification:\n\n${this.personality}`,
        capability,
        reference === 'NO_REFERENCE_MATERIAL'
          ? 'You have no stored reference material for this question.'
          : `Reference material follows.\n\n${reference}`,
        memoryBlock,
        guidance,
        'Ordinary conversation cannot take actions or run commands. The separate coding workflow records real tool activity and approvals. Never claim an action occurred unless a recorded tool result confirms it.',
      ].filter(Boolean).join('\n\n');

      const messages = [
        { role: 'system', content: systemPrompt },
        ...this.history,
        { role: 'user', content: text },
      ];
      const result = await this.post<OllamaChat>('/api/chat', {
        model: MODEL_NAME,
        messages,
        stream: false,
        keep_alive: '10m',
        options: { num_ctx: 4096, num_predict: 512, temperature: 0.3 },
      }, signal);
      const loaded = await this.get<LoadedModels>('/api/ps', signal);
      if (!loaded.models.some((entry) => entry.name === MODEL_NAME && entry.digest === MODEL_DIGEST)) {
        throw new Error('The approved Gemma model digest is unavailable or no longer the default. Chat is paused.');
      }
      if (requestGeneration !== this.generation) throw new Error('Conversation was cleared.');
      const raw = result.message?.content?.trim();
      if (result.message?.role !== 'assistant' || !raw) throw new Error('The local model returned an empty response.');

      // Citations are appended from real stored sources only, and only the
      // markers the model actually used are kept.
      const cited = extractUsedCitations(raw, grounding);
      const supportedAnswer = raw.replace(/\s*\[(\d{1,2})\]/g, (marker, number: string) => cited.some((line) => line.startsWith(`[${number}]`)) ? marker : '').trim();
      const falseMemoryClaim = containsFalseMemoryAction(supportedAnswer);
      const answer = falseMemoryClaim
        ? 'I have not saved, updated or forgotten a personal memory in this reply. Ask me directly to remember, update or forget something if you want to change stored memory.'
        : cited.length > 0 ? `${supportedAnswer}\n\nSources:\n${cited.join('\n')}` : supportedAnswer;
      this.history.push({ role: 'user', content: text }, { role: 'assistant', content: answer });
      this.detail = falseMemoryClaim
        ? 'No personal memory was changed.'
        : grounding.hasKnowledge
        ? `Answered from ${grounding.passages.length} stored source passage(s).`
        : this.memory?.summary().count
          ? `Local model answered with ${this.memory.summary().count} stored personal memories in context.`
          : 'Local model ready. Nothing in the knowledge base matched, so this reply is not sourced.';
      return this.snapshot('ready');
    } catch (error) {
      if (controller.signal.aborted && requestGeneration === this.generation) {
        this.history.push({ role: 'user', content: text }, { role: 'assistant', content: 'Response cancelled.' });
        this.detail = 'Response cancelled.';
        return this.snapshot('ready');
      }
      this.detail = this.describe(error);
      throw new Error(this.detail, { cause: error });
    } finally {
      if (this.active === controller) this.active = null;
    }
  }

  clearConversation(): ChatStatus {
    this.generation++;
    this.active?.abort();
    this.codingAbort?.abort();
    this.active = null;
    this.history.length = 0;
    this.detail = 'Conversation cleared. No messages are saved across restarts.';
    return this.snapshot('ready');
  }

  shutdown(): void {
    this.active?.abort();
    this.codingAbort?.abort();
    this.active = null;
    this.history.length = 0;
  }

  cancelCurrentRequest(): ChatStatus {
    this.codingAbort?.abort();
    this.active?.abort();
    return this.snapshot('ready');
  }
}

/**
 * Render the bounded personal-memory block for the system prompt.
 *
 * Personal memory is what Karl told Astra directly. It is labelled as such and
 * kept separate from retrieved research passages so she can tell the two apart,
 * and so a website can never appear as a statement Karl made.
 */
function memoryPromptBlock(memory: MemoryChatPort, query: string): string {
  const block = memory.contextFor(query);
  const lines: string[] = [];
  if (block.relevant.length > 0) {
    lines.push(
      '## Personal memory: things Karl told Astra directly (trusted)',
      'These are facts Karl stated himself. Use them when they are relevant, and never describe them as something you read online.',
      ...block.relevant.map((memory2) => `- (${memory2.category.replace('_', ' ')}) ${memory2.statement}`),
    );
  }
  if (block.summary.length > 0) {
    lines.push(
      '## Other saved personal context (trusted, may be irrelevant here)',
      ...block.summary.map((memory2) => `- (${memory2.category.replace('_', ' ')}) ${memory2.statement}`),
    );
  }
  if (lines.length === 0) return 'Karl has not saved any personal memory yet. Never invent a memory about him.';
  return `${lines.join('\n')}\nIf a question is about Karl personally and nothing here answers it, say you do not remember rather than guessing.`;
}

function describeMemoryAction(action: MemoryCommandResult['action']): string {
  switch (action) {
    case 'remembered':
      return 'Personal memory saved to the local database.';
    case 'updated':
      return 'Personal memory updated; the previous version is marked superseded.';
    case 'forgot':
      return 'Personal memory forgotten and excluded from future answers.';
    case 'conversation_forgotten':
      return 'Nothing from this conversation will be remembered.';
    case 'recalled':
      return 'Answered from stored personal memory.';
    case 'explained':
      return 'Explained chat and personal-memory persistence. Nothing saved.';
    default:
      return 'Local model ready.';
  }
}

/** Generated text is never evidence that a database mutation succeeded. */
function containsFalseMemoryAction(answer: string): boolean {
  return /\b(?:i(?:'ve| have)?|astra has)\s+(?:now\s+)?(?:saved|stored|updated|changed|forgotten|deleted|removed)\s+(?:that|this|your|my|it|a\s+(?:personal\s+)?memory)\b/i.test(answer)
    || /\b(?:saved|stored|updated|forgotten|deleted)\s+(?:to|from|in)\s+(?:my|your|personal)\s+memory\b/i.test(answer)
    || /\bi\s*(?:will|'ll)\s+(?:remember|save|store)\s+(?:that|this|it|your|my)\b/i.test(answer);
}
