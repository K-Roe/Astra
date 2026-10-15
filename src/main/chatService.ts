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
        const project = snapshot.buildReport;
        if (project) {
          this.history.push({ role: 'assistant', content: describeProjectBuild(project) });
          return;
        }
        if (snapshot.plan?.fileOperation) {
          const operation = snapshot.plan.fileOperation;
          const done = describeVerifiedFileOperation(operation);
          if (done) {
            this.history.push({ role: 'assistant', content: done });
            return;
          }
        }
        if (snapshot.plan?.application) {
          this.history.push({ role: 'assistant', content: `**React application verified in ${snapshot.plan.application.root}.** The approved files are present and the approved build passed. Run \`${snapshot.plan.application.launchCommand}\` from that directory to start the development server. Astra has not started or checked a server.` });
          return;
        }
        const last = snapshot.testResults.at(-1);
        this.history.push({ role: 'assistant', content: `Coding task #${snapshot.taskId} completed in ${snapshot.repository}. ${last ? `${snapshot.testResults.filter((result) => result.ok).length}/${snapshot.testResults.length} approved checks passed. ` : 'No executable checks were run. '}${snapshot.diff ? `Git diff: ${snapshot.diff.filesChanged} file(s), +${snapshot.diff.insertions}/-${snapshot.diff.deletions}.` : 'No Git diff was available.'} Review the full diff in Coding.` });
      } else if (event.kind === 'task.failed') {
        this.history.push({ role: 'assistant', content: snapshot.buildReport
          ? describeProjectBuild(snapshot.buildReport)
          : `Coding task #${snapshot.taskId} is incomplete: ${snapshot.error ?? event.label}. Review the test output and changed files in Coding. Continue this objective after resolving the stated blocker.` });
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
        'Ordinary conversation also cannot inspect the disk, read Git metadata, contact a local service, or start one. Do not state that a repository, project, folder or file exists, do not name a path as its location, do not call anything a Git repository, and do not say a local website is running or available. You have no way to know any of these here, so say plainly that you have not checked, and offer to have Astra check it for real.',
        this.coding ? 'Runtime capability: scoped repository and file operations are available through the approval-based coding workflow. An action succeeds only after a trusted filesystem result and verification. Astra can also verify whether a path exists, whether it is a Git repository, and whether a local address is listening, but only as a separate request that runs a real check.' : 'Runtime capability: the coding and file service is unavailable.',
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
      // Generated prose is never evidence. Each detector below names a class of
      // claim that only a trusted tool result may make, so a reply that asserts
      // one without a tool behind it is replaced by a truthful statement of what
      // did and did not happen, plus the action that would establish the truth.
      const violation = unverifiedClaimKind(supportedAnswer);
      const answer = violation
        ? UNVERIFIED_CLAIM_REPLIES[violation]
        : cited.length > 0 ? `${supportedAnswer}\n\nSources:\n${cited.join('\n')}` : supportedAnswer;
      this.history.push({ role: 'user', content: text }, { role: 'assistant', content: answer });
      this.detail = violation
        ? CLAIM_DETAILS[violation]
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

/**
 * Report a finished project build from what was actually observed.
 *
 * Every line here is a value the build measured: the path it wrote to, the
 * file count it verified by reading back, whether validation actually passed,
 * and the issues it could not resolve. The launch command is documentation —
 * Astra never starts a server, so it never says the site is running.
 */
function describeProjectBuild(report: {
  name: string;
  root: string;
  files: number;
  fromModel: number;
  validated: boolean;
  commandsRun: number;
  launchCommand: string;
  issues: readonly string[];
}): string {
  const lines = [
    report.validated ? `**${report.name} was built and verified on disk.**` : `**${report.name} is incomplete.**`,
    '',
    `- Location: \`${report.root}\``,
    `- Files written and read back: ${report.files}`,
    `- Of those, produced by the local coding model: ${report.fromModel}`,
    `- Validation commands run: ${report.commandsRun}, all passed: ${report.validated ? 'yes' : 'no'}`,
    report.validated ? '- Approved validation passed with available dependencies.' : '- Dependency and validation status: see remaining issues below.',
    report.issues.length ? '' : null,
    ...(report.issues.length ? ['**Remaining issues:**', ...report.issues.map((issue) => `- ${issue}`)] : []),
    '',
    report.validated ? `**Launch it yourself:** \`${report.launchCommand}\` from \`${report.root}\`.` : `**After resolving the issues:** launch with \`${report.launchCommand}\` from \`${report.root}\`.`,
    'Astra did not start a server and has not checked that anything is listening on that port; it can do so if you ask.',
  ].filter((line) => line !== null);
  return lines.join('\n');
}

/**
 * Report a completed direct operation in the past tense, from the plan.
 *
 * Only says what the verified operation actually was: a directory operation is
 * never described as a file, and a recursive delete reports the count of
 * entries that were listed and confirmed absent.
 */
function describeVerifiedFileOperation(operation: {
  action: string;
  target: string;
  content?: string;
  entryCount?: number;
}): string | null {
  switch (operation.action) {
    case 'create_directory':
      return `Created and verified the empty directory ${operation.target} on disk. No file was written and no Git repository or remote was created.`;
    case 'delete_directory':
      return `Deleted and verified ${operation.target} on disk. It and the ${operation.entryCount ?? 0} listed entr${operation.entryCount === 1 ? 'y' : 'ies'} are absent. This was a recursive deletion of a directory that was listed before approval.`;
    case 'delete':
      return `Deleted and verified ${operation.target} on disk. The file is absent.`;
    case 'create':
      return `Created and verified ${operation.target} on disk. The file contains the exact approved content (${Buffer.byteLength(operation.content ?? '', 'utf8')} bytes). No Git repository or remote was created.`;
    case 'edit':
      return `Edited and verified ${operation.target} on disk. The file contains the exact approved content (${Buffer.byteLength(operation.content ?? '', 'utf8')} bytes). No Git repository or remote was created.`;
    default:
      return `Wrote and verified ${operation.target} on disk. The file contains the exact approved content (${Buffer.byteLength(operation.content ?? '', 'utf8')} bytes). No Git repository or remote was created.`;
  }
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

/**
 * Classes of claim that only a trusted tool result may make.
 *
 * Each exists because a generated sentence once made that claim without a tool
 * behind it. Ordering matters only for the replacement text shown to Karl.
 */
export type UnverifiedClaim =
  | 'service'
  | 'location'
  | 'git'
  | 'file'
  | 'memory';

const SERVICE_CLAIM: readonly RegExp[] = [
  /\b(?:website|site|server|app|application|page)\b[^.!?]*\b(?:is|are|now|available|live|reachable|running|hosted|served)\b[^.!?]*\b(?:running|live|available|reachable|hosted|up|listening)\b/i,
  /\b(?:running|available|live|reachable)\b[^.!?]*\b(?:at|on)\b[^.!?]*\b(?:localhost|127\.0\.0\.1|\[::1\]|https?:\/\/)/i,
  /\b(?:i(?:'ve| have)?|astra has)\s+(?:now\s+)?(?:started|launched|spun up|hosted|deployed|served)\b/i,
];

/** Naming a path as the location of something, or asserting that it exists. */
const LOCATION_CLAIM: readonly RegExp[] = [
  /\b(?:repository|repo|project|folder|directory|site|website|blog)\b[^.!?]*\b(?:is|are|now)\b[^.!?]*\b(?:located|at|in|under|inside)\b/i,
  /\b(?:now\s+)?(?:located|sits|lives|stored|kept)\b[^.!?]*\b(?:at|in|under)\b/i,
  /\b(?:path|directory|folder|repository|repo|project)\b[^.!?]*\b(?:does\s+)?(?:not\s+)?exists?\b/i,
];

/** Calling a directory a Git repository, or asserting a commit/push happened. */
const GIT_CLAIM: readonly RegExp[] = [
  /\b(?:is|are|now)\s+(?:a\s+|an\s+|the\s+)?(?:git|version-controlled)\b/i,
  /\b(?:initiali[sz]ed|initialised|initialized)\s+(?:a\s+|an\s+)?git\b/i,
  /\b(?:git\s+)?(?:repo|repository)\b[^.!?]*\b(?:created|set up|initiali[sz]ed)\b/i,
  /\b(?:committed|pushed)\b[^.!?]*\b(?:to|onto)\b/i,
];

/** A generated sentence cannot substitute for a verified filesystem result. */
const FILE_CLAIM: readonly RegExp[] = [
  /\b(?:i(?:'ve| have)?|astra has)\s+(?:now\s+)?(?:created|written|saved|edited|updated|deleted|removed)\s+(?:the\s+|your\s+|a\s+|this\s+)?(?:file|folder|directory|[A-Za-z0-9_.-]+\.[A-Za-z0-9]{1,8})\b/i,
  /\b(?:file|folder|directory)\s+(?:has been|was)\s+(?:created|written|saved|edited|updated|deleted|removed)\b/i,
  /\b(?:the|your)\s+file\s+(?:now\s+)?exists\b/i,
];

/** Generated text is never evidence that a database mutation succeeded. */
const MEMORY_CLAIM: readonly RegExp[] = [
  /\b(?:i(?:'ve| have)?|astra has)\s+(?:now\s+)?(?:saved|stored|updated|changed|forgotten|deleted|removed)\s+(?:that|this|your|my|it|a\s+(?:personal\s+)?memory)\b/i,
  /\b(?:saved|stored|updated|forgotten|deleted)\s+(?:to|from|in)\s+(?:my|your|personal)\s+memory\b/i,
  /\bi\b\s*(?:have|'ve)?\s*(?:recorded|noted|logged|registered|written down)\s+(?:that|this|it)\b[^.!?]*\b(?:memory|remembered|memor(?:y|ies))\b/i,
  /\b(?:i\s*(?:will|'ll)|i(?:'ve| have))\s+(?:remember|save|store|record)\s+(?:that|this|it|your|my)\b/i,
];

/**
 * Identify the strongest unsupported claim in a generated reply, or null.
 *
 * Exported for regression tests: the defect being guarded against was a class
 * of missing coverage, so the detector itself is part of the contract.
 */
export function unverifiedClaimKind(answer: string): UnverifiedClaim | null {
  if (SERVICE_CLAIM.some((pattern) => pattern.test(answer))) return 'service';
  if (GIT_CLAIM.some((pattern) => pattern.test(answer))) return 'git';
  if (LOCATION_CLAIM.some((pattern) => pattern.test(answer))) return 'location';
  if (MEMORY_CLAIM.some((pattern) => pattern.test(answer))) return 'memory';
  if (FILE_CLAIM.some((pattern) => pattern.test(answer))) return 'file';
  return null;
}

/**
 * Truthful replacements.
 *
 * None of these refuses the underlying request. Each states what was not
 * verified and names the real action that would establish the truth, so the
 * tools stay usable rather than Astra being taught to say no.
 */
const UNVERIFIED_CLAIM_REPLIES: Readonly<Record<UnverifiedClaim, string>> = {
  service: 'I have not verified that anything is serving a local address, and I did not start anything. Astra cannot launch web servers. Give me the address and Astra will open a real connection and report whether anything accepted it.',
  location: 'I have not checked the filesystem in this reply, so I cannot confirm where that project lives. Astra can check: ask it to verify the path and it will inspect the disk and report what it actually finds.',
  git: 'I have not read any Git metadata in this reply, so I cannot call that a repository. Astra can check by looking for real .git metadata — ask it to verify and it will report exactly what it finds.',
  file: 'I have not created, edited or deleted a file in this reply. Tell me the intended file and what it should contain, and I can draft a proposal for your approval.',
  memory: 'I have not saved, updated or forgotten a personal memory in this reply. Ask me directly to remember, update or forget something and the memory service will confirm the result.',
};

const CLAIM_DETAILS: Readonly<Record<UnverifiedClaim, string>> = {
  service: 'No local service was contacted.',
  location: 'No filesystem check was run.',
  git: 'No Git metadata was read.',
  file: 'No filesystem operation was run.',
  memory: 'No personal memory was changed.',
};
