import type { ChatMessage, ChatStatus } from '../shared/contracts';
import {
  extractUsedCitations,
  groundingInstruction,
  referenceBlock,
  type GroundingContext,
} from './knowledge/grounding';
import type { CodingBridge } from './agent/codingBridge';

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
  private detail = 'Local model ready. Conversation stays in this running session.';

  constructor(
    private readonly personality: string,
    private readonly request: typeof fetch = fetch,
    /** Optional retrieval hook; absent means a plain, unsourced conversation. */
    private readonly grounder?: (query: string) => GroundingContext,
    /** Optional coding tool bridge; absent means chat cannot act on repositories. */
    private readonly coding?: CodingBridge,
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
    return { state, detail: this.detail, messages: this.history.map((message) => ({ ...message })) };
  }

  async getStatus(): Promise<ChatStatus> {
    try {
      await this.verifyModel(AbortSignal.timeout(5000));
      this.detail = 'Local model ready. Conversation stays in this running session.';
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
      const grounding = this.grounder
        ? this.grounder(text)
        : { passages: [], memories: [], hasKnowledge: false, stalePassages: 0 };
      const reference = referenceBlock(grounding);
      const guidance = groundingInstruction(grounding);

      const systemPrompt = [
        `You are Astra, a local-first desktop companion. Follow this authored personality specification:\n\n${this.personality}`,
        reference === 'NO_REFERENCE_MATERIAL'
          ? 'You have no stored reference material for this question.'
          : `Reference material follows.\n\n${reference}`,
        guidance,
        'Ordinary conversation cannot take actions or run commands. The separate coding workflow records real tool activity and approvals. Never claim an action occurred unless a recorded tool result confirms it.',
      ].join('\n\n');

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
      const answer = grounding.hasKnowledge && /\[\d+\]/.test(raw)
        ? `${raw}\n\nSources:\n${extractUsedCitations(raw, grounding).join('\n')}`
        : raw;
      this.history.push({ role: 'user', content: text }, { role: 'assistant', content: answer });
      this.detail = grounding.hasKnowledge
        ? `Answered from ${grounding.passages.length} stored source passage(s).`
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
