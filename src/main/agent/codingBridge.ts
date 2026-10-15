import {
  extractNewRepositoryName,
  extractAbsoluteFilePath,
  extractRepositoryHint,
  extractStackHints,
  routeCodingIntent,
  type CodingIntent,
} from './codingIntent';
import type { CodingAgent, TaskSnapshot, ToolEvent } from './codingAgent';
import { discoverRepositories, readProjectFile, searchProjectCode, describeProject, listProjectFiles } from '../workspace/repoTools';
import { type SandboxOptions } from '../workspace/pathGuard';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { proposeCodingPatch, proposeFileContent, type ModelProposal } from './codingModel';
import { gitStatus } from '../workspace/fileTools';
import { planDirectFileAction, readDirectFile, type DirectFileAction } from '../workspace/fileTools';
import { PRELIMINARY_CODING_RELIABILITY, routeTask } from '../models/codingBenchmark';

/**
 * The conversation-to-tools bridge.
 *
 * Turns a plain message into either an ordinary chat reply or a real coding
 * action. Two rules define the whole design:
 *
 *  1. **Read-only intents run immediately; mutating intents never do.** An
 *     intent like `fix_bug` produces a plan and stops. The only thing that
 *     changes files is an explicit approval, and only within the plan's scope.
 *  2. **Repository documentation is context, not authority.** Its text is
 *     summarised as a note in the plan and is never parsed for commands.
 *
 * Commands are never taken from model prose. The command set comes from the
 * repository's own metadata (its test script), and anything else is refused.
 */

export interface ChatToolResult {
  /** Present when a coding action ran and the UI should show a task. */
  readonly snapshot?: TaskSnapshot;
  /** Prose Astra should say in chat. */
  readonly reply: string;
  /** True when a coding task is now active. */
  readonly handled: boolean;
}

export class CodingBridge {
  constructor(
    private readonly agent: CodingAgent,
    private readonly sandbox: SandboxOptions,
    private readonly proposer: (objective: string, repository: string, files: readonly string[], sandbox: SandboxOptions, request?: typeof fetch, cancellation?: AbortSignal) => Promise<ModelProposal> = proposeCodingPatch,
    private readonly isExecuting: () => boolean = () => false,
    private readonly codingRoute: () => { permitted: boolean; reason: string } = () => routeTask('coding', { codingReliability: PRELIMINARY_CODING_RELIABILITY }),
    private readonly fileProposer: typeof proposeFileContent = proposeFileContent,
  ) {}

  onActivity(listener: (event: ToolEvent, snapshot: TaskSnapshot) => void): () => void {
    return this.agent.onActivity((event) => listener(event, this.agent.snapshot()));
  }

  /**
   * Handle one user message. Returns null when this is ordinary conversation
   * and the chat model should answer instead.
   */
  async handle(message: string, cancellation?: AbortSignal): Promise<ChatToolResult | null> {
    const intent = routeCodingIntent(message);
    if (intent.kind === 'chitchat') return null;

    if (intent.needsClarification) {
      return { reply: intent.needsClarification, handled: true };
    }

    switch (intent.kind) {
      case 'list_repositories':
        return { reply: await this.listRepositories(), handled: true };
      case 'select_repository':
        return this.selectRepository(intent, message);
      case 'explain_project':
        return this.explainProject();
      case 'find_code':
        return this.findCode(intent);
      case 'show_changes':
        return this.showChanges();
      case 'cancel_task':
        return this.cancel();
      case 'investigate_tests':
      case 'fix_bug':
      case 'add_feature':
        return this.startTask(intent, message, cancellation);
      case 'run_tests':
        return this.runTests();
      case 'create_repository':
        return this.proposeNewRepository(message);
      case 'read_file':
        return this.readFile(message);
      case 'create_file':
      case 'write_file':
      case 'edit_file':
      case 'delete_file':
        return this.proposeFileOperation(intent.kind.replace('_file', '') as DirectFileAction, message, cancellation);
      default:
        return null;
    }
  }

  // ------------------------------------------------------------ read-only

  private async listRepositories(): Promise<string> {
    const repos = discoverRepositories(this.sandbox);
    if (repos.length === 0) return 'No repositories were found under the approved root.';
    const lines = await Promise.all(repos.map(async (repo) => {
      const described = describeProject(repo.root, this.sandbox);
      const status = await gitStatus(repo.root, this.sandbox);
      const tests = described.testCommands.length ? `, tests: ${described.testCommands.join(', ')}` : '';
      return `- **${repo.name}** — ${repo.root} (branch: ${status.branch ?? 'unknown'}, tree: ${status.clean ? 'clean' : 'dirty'}, ${described.detectedLanguages.join(', ') || 'language unknown'}${tests})`;
    }));
    const current = this.agent.getRepository();
    return `Found ${repos.length} repository/repositories under ${this.sandbox.root}:\n\n${lines.join('\n')}${current ? `\n\nCurrently selected: ${current}` : ''}`;
  }

  private async selectRepository(intent: CodingIntent, message: string): Promise<ChatToolResult> {
    const hint = intent.repositoryName ?? extractRepositoryHint(message);
    if (!hint) return { reply: 'Which repository should Astra open? It must be under the approved root.', handled: true };

    // Never trust the spoken name as a path: match it against what was
    // actually discovered, then resolve that real path.
    const repos = discoverRepositories(this.sandbox);
    const wanted = hint.toLowerCase();
    const match = repos.find((r) => r.name.toLowerCase() === wanted)
      ?? repos.find((r) => r.name.toLowerCase().includes(wanted))
      ?? repos.find((r) => wanted.includes(r.name.toLowerCase()));

    if (!match) {
      const available = repos.slice(0, 20).map((r) => r.name).join(', ');
      return {
        reply: `No repository called "${hint}" was found under the approved root.${available ? ` Available: ${available}` : ''}`,
        handled: true,
      };
    }

    try {
      const selected = this.agent.selectRepository(match.root);
      const described = describeProject(selected, this.sandbox);
      const detail = [
        `Selected **${match.name}** at ${selected}.`,
        described.description ? `Description: ${described.description}` : null,
        described.detectedLanguages.length ? `Languages: ${described.detectedLanguages.join(', ')}` : null,
        described.testCommands.length ? `Suggested test command: ${described.testCommands.join(', ')}` : null,
      ].filter(Boolean).join('\n');
      return { reply: `${detail}\n\nNothing has been changed. Astra will only modify files after a plan is approved.`, handled: true };
    } catch (error) {
      return { reply: `Astra refused to open that repository: ${error instanceof Error ? error.message : String(error)}`, handled: true };
    }
  }

  private explainProject(): ChatToolResult {
    const repository = this.agent.getRepository();
    if (!repository) return { reply: 'Astra has no repository selected. Ask to open one first.', handled: true };
    const described = describeProject(repository, this.sandbox);
    const parts = [
      `**${described.name}** at ${described.root}`,
      described.description || 'No description found in package.json or README.md.',
      `Languages: ${described.detectedLanguages.join(', ') || 'unknown'}`,
      `Frameworks: ${described.frameworks.join(', ') || 'none detected'}`,
      described.testCommands.length ? `Test commands: ${described.testCommands.join(', ')}` : 'No test command was detected in the project metadata.',
      `About ${described.fileCount} indexable file(s). Secret and dependency files are excluded from this count.`,
    ];
    return { reply: parts.join('\n'), handled: true };
  }

  private findCode(intent: CodingIntent): ChatToolResult {
    const repository = this.agent.getRepository();
    if (!repository) return { reply: 'Astra has no repository selected. Ask to open one first.', handled: true };
    const term = intent.searchTerm;
    if (!term) return { reply: 'What exactly should Astra search for?', handled: true };

    const hits = searchProjectCode(repository, this.sandbox, term, { maxMatches: 40 });
    if (hits.length === 0) {
      return { reply: `No matches for "${term}" in ${repository}. Astra searched only indexable, non-secret files.`, handled: true };
    }
    const byFile = new Map<string, number>();
    for (const hit of hits) byFile.set(hit.relativePath, (byFile.get(hit.relativePath) ?? 0) + 1);
    const summary = [...byFile.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([file, count]) => `- \`${file}\` (${count} match${count === 1 ? '' : 'es'})`)
      .join('\n');
    const sample = hits.slice(0, 5).map((h) => `  ${h.relativePath}:${h.line} — ${h.text.trim().slice(0, 120)}`).join('\n');
    return { reply: `Found ${hits.length} match(es) for "${term}":\n\n${summary}\n\nExamples:\n${sample}`, handled: true };
  }

  private async showChanges(): Promise<ChatToolResult> {
    if (this.isExecuting()) return { reply: 'The approved coding workflow is still running. Its current changes and tool activity are visible in Coding; ask for the final diff when it finishes.', handled: true };
    const repository = this.agent.getRepository();
    if (!repository) return { reply: 'Astra has no repository selected.', handled: true };
    try {
      const snapshot = await this.agent.review();
      const diff = snapshot.diff;
      if (!diff || diff.filesChanged === 0) {
        const tree = snapshot.workingTree;
        return {
          reply: tree && !tree.clean
            ? `There is no committed diff to show, but the working tree has uncommitted changes (${tree.lines.filter((l) => !l.startsWith('##')).length}). Astra will not discard them.`
            : 'There are no changes to show in this repository.',
          handled: true,
        };
      }
      return {
        reply: `${diff.filesChanged} file(s) changed, +${diff.insertions}/-${diff.deletions}.\n\n\`\`\`diff\n${diff.diff.slice(0, 3000)}\n\`\`\``,
        handled: true,
        snapshot,
      };
    } catch (error) {
      return { reply: `Astra could not read the diff: ${error instanceof Error ? error.message : String(error)}`, handled: true };
    }
  }

  private async cancel(): Promise<ChatToolResult> {
    const snapshot = await this.agent.cancel();
    return {
      reply: snapshot.phase === 'cancelled'
        ? `Cancelled. No further tool actions will run for this task.${snapshot.error ? ` Reason: ${snapshot.error}` : ''}`
        : 'There is no active coding task to cancel.',
      handled: true,
      snapshot,
    };
  }

  // ------------------------------------------------------------- mutating

  /**
   * Investigate and produce a plan. Nothing is modified here; the plan must be
   * approved separately.
   */
  private async startTask(intent: CodingIntent, message: string, cancellation?: AbortSignal): Promise<ChatToolResult> {
    if (['investigating', 'planning', 'awaiting_approval', 'implementing', 'testing', 'reviewing'].includes(this.agent.snapshot().phase)) {
      return { reply: 'A coding task is already in progress. Finish, reject or cancel it before starting another.', handled: true };
    }
    const route = this.codingRoute();
    if (!route.permitted) return { reply: `Astra cannot delegate a code patch to the local coding model: ${route.reason}. Please inspect the repository manually or run a new coding benchmark.`, handled: true };
    // "Fix the bug in BrightSpeakAPI" names its repository, so honour it rather
    // than making Karl open it in a separate turn. Naming is not authority: the
    // name is still matched against discovered repositories and re-resolved.
    if (intent.repositoryName) {
      const repos = discoverRepositories(this.sandbox);
      const wanted = intent.repositoryName.toLowerCase();
      const match = repos.find((r) => r.name.toLowerCase() === wanted)
        ?? repos.find((r) => r.name.toLowerCase().includes(wanted));
      if (!match) return { reply: `I could not find a repository named ${intent.repositoryName} under ${this.sandbox.root}. Please select an existing repository first.`, handled: true };
      const selected = this.agent.getRepository();
      if (selected && selected.toLowerCase() !== match.root.toLowerCase()) {
        return { reply: `The selected repository is ${selected}, but your request names ${match.root}. Ask Astra to open ${match.name} first. No coding task was started.`, handled: true };
      }
      if (!selected) this.agent.selectRepository(match.root);
    }

    const repository = this.agent.getRepository();
    if (!repository) {
      return { reply: 'Astra has no repository selected. Ask to open a repository first, and nothing will be changed until a plan is approved.', handled: true };
    }

    const hints = extractSearchHints(message);
    const testCommands = await this.detectTestCommand(repository);
    const proposedCommands = testCommands
      ? [{ executable: testCommands.executable, args: testCommands.args, purpose: 'Run the project test suite' }]
      : [];
    // Investigation adds its own hints so a vague request still produces a
    // concrete, reviewable file list rather than an empty plan.
    const investigationHints = hints.length > 0 ? hints : await this.investigationHints();
    const proposedFiles = await this.candidateFiles(repository, investigationHints);
    if (proposedFiles.length === 0) {
      return { reply: 'I could not identify a specific source file. Please name the failing test, function, or file so I can investigate safely.', handled: true };
    }
    if (path.basename(repository).toLowerCase() === 'astra' && proposedFiles.some((file) => /(^|\/)(approvals|pathGuard|commandRunner|codingAgent|codingBridge|codingModel|intelligenceService)(\/|\.|$)/i.test(file))) {
      return { reply: 'This request touches Astra’s coding security boundary. It needs separate owner authorisation before Astra can propose an edit to those files.', handled: true };
    }
    let model;
    this.agent.setInvestigatingProposal(true);
    try {
      model = await this.proposer(message.trim(), repository, proposedFiles, this.sandbox, fetch, cancellation);
    } catch (error) {
      if (cancellation?.aborted) throw error;
      return { reply: `I inspected the candidate files, but the coding model could not produce a validated patch: ${error instanceof Error ? error.message : String(error)}. Please narrow the task or give me the relevant file. No task was approved or changed.`, handled: true };
    } finally {
      this.agent.setInvestigatingProposal(false);
    }
    if (cancellation?.aborted) throw new Error('coding investigation cancelled');

    const snapshot = await this.agent.beginTask({
      objective: message.trim(),
      repository,
      // Candidate discovery was already completed above. Only the files in
      // the validated patch belong in the approval scope.
      searchHints: [],
      proposedFiles: model.patches.map((patch) => patch.file),
      proposedPatches: model.patches,
      proposedCommands,
      rootCause: model.rootCause,
      expectedOutcome: model.expectedOutcome,
      risks: model.risks,
      branch: (await gitStatus(repository, this.sandbox)).clean ? `astra/${intent.kind}-${Date.now().toString(36)}` : null,
    });

    const plan = snapshot.plan;
    if (!plan) return { reply: 'Astra could not produce a plan for that request.', handled: true, snapshot };

    const lines = [
      `I'll investigate this in **${plan.repository}** and propose a bounded change.`,
      '',
      `**Objective:** ${plan.objective}`,
      plan.rootCause ? `**Assessment:** ${plan.rootCause}` : null,
      `**Files to change:** ${plan.filesToChange.join(', ')}`,
      `**Commands proposed:** ${plan.commands.length ? plan.commands.map((c) => `${c.executable} ${c.args.join(' ')}`).join(', ') : 'none'}`,
      `**Expected outcome:** ${plan.expectedOutcome}`,
      `**Risks:** ${plan.risks.join(' ')}`,
      plan.branch ? `**Task branch:** \`${plan.branch}\`` : null,
      '',
      'Nothing has been changed and no command has been run. Approve this plan in chat or the Coding workspace, or tell Astra to cancel.',
    ].filter(Boolean).join('\n');

    return { reply: lines, handled: true, snapshot };
  }

  private async runTests(): Promise<ChatToolResult> {
    if (this.isExecuting()) return { reply: 'The approved coding workflow is already running. Its test results will appear in Coding when the command finishes.', handled: true };
    const repository = this.agent.getRepository();
    if (!repository) return { reply: 'Astra has no repository selected.', handled: true };
    const snapshot = this.agent.snapshot();
    if (!snapshot.plan) {
      return { reply: 'There is no approved plan for this repository, so Astra will not run any command. Ask for a task first, then approve its plan.', handled: true };
    }
    const command = snapshot.plan.commands[0];
    if (!command) return { reply: 'The approved plan contains no test command.', handled: true, snapshot };

    try {
      const after = await this.agent.runApprovedCommand(command.executable, command.args);
      const last = after.testResults[after.testResults.length - 1];
      return {
        reply: `${last.command} ${last.ok ? 'passed' : `failed with exit ${last.exitCode}`}.\n${last.summary}`,
        handled: true,
        snapshot: after,
      };
    } catch (error) {
      return { reply: `Astra refused to run that command: ${error instanceof Error ? error.message : String(error)}`, handled: true, snapshot };
    }
  }

  private async proposeNewRepository(message: string): Promise<ChatToolResult> {
    if (['investigating', 'planning', 'awaiting_approval', 'implementing', 'testing', 'reviewing'].includes(this.agent.snapshot().phase)) {
      return { reply: 'A coding task is already in progress. Finish, reject or cancel it before starting another.', handled: true };
    }
    const name = extractNewRepositoryName(message);
    if (!name) {
      return { reply: 'What should the new repository be called? For example: "create a React and TypeScript dashboard called MyDashboard".', handled: true };
    }
    if (!/^[A-Za-z][A-Za-z0-9_-]{1,39}$/.test(name) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(name)) {
      return { reply: 'That repository name is not a safe Windows directory name. Use letters, digits, underscores or hyphens.', handled: true };
    }
    const target = path.join(this.sandbox.root, name);
    const stack = extractStackHints(message);
    const scaffold = buildScaffold(name, stack);

    let available = true;
    let reason = '';
    if (existsSync(target)) {
      available = false;
      reason = 'A directory with that name already exists. Astra will not overwrite it.';
    }

    const lines = [
      `**Proposed new repository**`,
      '',
      `- Path: \`${target}\``,
      `- Stack: ${stack.length ? stack.join(', ') : 'plain Node.js'}`,
      `- Files that would be created: ${Object.keys(scaffold).join(', ')}`,
      `- Git: initialised locally, with **no** remote created`,
      `- Availability: ${available ? 'destination is free' : `NOT AVAILABLE - ${reason}`}`,
      '',
      '**Dependency installation is currently blocked.** Package managers run arbitrary lifecycle scripts, so Astra will not run `npm install` or fetch remote packages. The scaffold will be created without installed dependencies, and Karl will need to install them manually.',
      '',
      available
        ? 'Review the Coding workspace proposal and approve to create it.'
        : 'Adjust the request or choose a different name.',
    ];
    if (!available) return { reply: lines.join('\n'), handled: true };
    const snapshot = await this.agent.beginTask({
      objective: message.trim(),
      newRepository: { name, path: target, files: scaffold },
      proposedFiles: Object.keys(scaffold),
      rootCause: 'A new local project was requested.',
      expectedOutcome: `${name} exists at ${target} with local Git metadata and the listed scaffold files.`,
      risks: ['Dependencies are declared but not installed. Install and build remain unverified until separately approved.'],
    });
    return { reply: lines.join('\n'), handled: true, snapshot };
  }

  private readFile(message: string): ChatToolResult {
    const target = extractAbsoluteFilePath(message);
    if (!target) return { reply: 'Which absolute file path under the approved repository root should I read?', handled: true };
    try {
      const result = readDirectFile(target, this.sandbox);
      const excerpt = result.content.slice(0, 6000);
      return { reply: `Read ${result.target} from disk (${result.bytes} bytes, SHA-256 ${result.sha256}).${excerpt.length < result.content.length ? ' Showing the first 6,000 characters.' : ''}\n\n\`\`\`\n${excerpt}\n\`\`\``, handled: true };
    } catch (error) {
      return { reply: `I could not read ${target}: ${error instanceof Error ? error.message : String(error)}. No file was changed.`, handled: true };
    }
  }

  private async proposeFileOperation(action: DirectFileAction, message: string, cancellation?: AbortSignal): Promise<ChatToolResult> {
    if (['investigating', 'planning', 'awaiting_approval', 'implementing', 'testing', 'reviewing'].includes(this.agent.snapshot().phase)) {
      return { reply: 'A coding task is already in progress. Finish, reject or cancel it before starting another.', handled: true };
    }
    const target = this.resolveDirectDestination(message);
    if (!target) return { reply: 'Which directory and filename under the approved repository root should I use?', handled: true };
    const fenced = /```(?:[A-Za-z0-9_+-]+)?\r?\n([\s\S]*?)\r?\n```/.exec(message);
    try {
      // Validate the destination and its current state before sending any context to Qwen.
      const preliminary = planDirectFileAction(target, this.sandbox, action, action === 'delete' ? undefined : 'proposal pending');
      const previous = preliminary.beforeSha256 ? readDirectFile(target, this.sandbox).content : null;
      if (!fenced && previous !== null && Buffer.byteLength(previous, 'utf8') > 16_000) {
        throw new Error('the existing file is too large for a safe whole-file model edit; request a narrower coding patch');
      }
      const context: { file: string; content: string }[] = [];
      if (!fenced && action !== 'delete') {
        for (const name of ['README.md', 'package.json']) {
          const candidate = path.join(path.dirname(target), name);
          if (candidate === target || !existsSync(candidate)) continue;
          try {
            const read = readDirectFile(candidate, this.sandbox);
            if (read.bytes <= 4000) context.push({ file: name, content: read.content });
          } catch { /* Context is optional; security and read failures do not widen scope. */ }
        }
      }
      const content = action === 'delete' ? undefined : fenced ? `${fenced[1]}\n` : await this.fileProposer(message, target, previous, context, fetch, cancellation);
      if (previous !== null && content?.trim() === previous.trim()) throw new Error('the proposed content is identical to the existing file');
      const operation = planDirectFileAction(target, this.sandbox, action, content);
      if (operation.beforeSha256 !== preliminary.beforeSha256) throw new Error('file changed while content was being drafted; request a fresh plan');
      const snapshot = await this.agent.beginTask({
        objective: message.trim(),
        fileOperation: operation,
        proposedFiles: [path.basename(operation.target)],
        expectedOutcome: `${operation.target} is ${action === 'delete' ? 'absent' : 'present with exactly the approved content'} after an independent filesystem check.`,
        rootCause: 'Karl requested a direct file operation.',
        risks: [action === 'delete' ? 'Deletion removes the current file after approval.' : 'The exact reviewed content will be written only after approval.'],
      });
      const lines = [
        `**Proposed file ${action}**`,
        `- Absolute path: \`${operation.target}\``,
        `- Parent directory: ${operation.createParent ? 'will be created after approval' : 'exists'}`,
        `- Existing file: ${operation.beforeSha256 ? `yes (SHA-256 ${operation.beforeSha256})` : 'no'}`,
        `- Git repository: none will be created`,
        ...(previous ? ['', `Existing content${previous.length > 6000 ? ' (first 6,000 characters)' : ''}:`, `\`\`\`\n${previous.slice(0, 6000)}\n\`\`\``] : []),
        ...(content ? ['', 'Full proposed content:', `\`\`\`\n${content}\n\`\`\``] : []),
        '',
        'Nothing has been changed. Review this exact operation in Coding and approve or reject it.',
      ];
      return { reply: lines.join('\n'), handled: true, snapshot };
    } catch (error) {
      return { reply: `I could not propose ${action} for ${target}: ${error instanceof Error ? error.message : String(error)}. No file was changed.`, handled: true };
    }
  }

  private resolveDirectDestination(message: string): string | null {
    const absolute = extractAbsoluteFilePath(message);
    if (absolute) return absolute;
    const named = /\b(?:called|named)\s+["'`]?([A-Za-z][A-Za-z0-9_.-]{0,80}\.[A-Za-z0-9]{1,8})["'`]?/i.exec(message)?.[1];
    const explicit = /\b([A-Za-z][A-Za-z0-9_.-]{0,80}\.(?:js|jsx|ts|tsx|vue|php|md|json|css|html))\b/i.exec(message)?.[1];
    const inferred = /\bREADME\b/i.test(message) ? 'README.md'
      : /\bbackstory\b/i.test(message) && /\bJavaScript\b/i.test(message) ? 'AstraBackstory.js'
      : /\bsettings\s+panel\b/i.test(message) && /\bVue\b/i.test(message) ? 'SettingsPanel.vue'
      : /\bprofiles?\b/i.test(message) && /\bLaravel\b/i.test(message) && /\bcontroller\b/i.test(message) ? 'ProfileController.php'
      : null;
    const name = named ?? explicit ?? inferred;
    if (!name) return null;
    const folder = /\b(?:in|inside|under)\s+(?:the\s+)?([A-Za-z][A-Za-z0-9_.-]{1,80})(?:\s+(?:folder|directory|project|repo|repository))?\b/i.exec(message)?.[1];
    const base = folder && !['this', 'current', 'project', 'repo', 'repository'].includes(folder.toLowerCase())
      ? path.join(this.sandbox.root, folder)
      : this.agent.getRepository();
    return base ? path.join(base, name) : null;
  }

  // --------------------------------------------------------------- helpers

  /** Read the project's own test script rather than guessing one. */
  private async detectTestCommand(repository: string): Promise<{ executable: string; args: readonly string[] } | null> {
    try {
      const read = readProjectFile(`${repository}\\package.json`, { root: repository }, { maxBytes: 100_000 });
      const parsed = JSON.parse(read.text) as { scripts?: Record<string, string> };
      const test = parsed.scripts?.test;
      if (typeof test === 'string' && test.trim()) {
        return { executable: 'npm', args: ['test'] };
      }
    } catch {
      // Not a Node project, or unreadable; no command is proposed.
    }
    return null;
  }

  /** Search terms Astra should try when the request names none, to seed a plan. */
  private async investigationHints(): Promise<string[]> {
    // Read-only probes that usually surface the files a test failure involves:
    // the test itself, the sources it imports, and common assertion forms.
    return ['test', 'import', 'assert', 'expect(', 'require('];
  }

  /** Files most likely involved, derived from the request by search only. */
  private async candidateFiles(repository: string, hints: readonly string[]): Promise<string[]> {
    const files = new Set<string>();
    for (const hint of hints) {
      for (const hit of searchProjectCode(repository, this.sandbox, hint, { maxMatches: 4 })) {
        if (!/^(node_modules|dist|build)\//.test(hit.relativePath)) files.add(hit.relativePath.replace(/\\/g, '/'));
      }
    }
    for (const file of listProjectFiles(repository, { root: repository }, { maxEntries: 150, maxDepth: 4 })) {
      if (files.size >= 6) break;
      if (/\.(ts|tsx|js|jsx|mjs|cjs|py|php)$/i.test(file.relativePath) && file.bytes <= 16_000) files.add(file.relativePath.replace(/\\/g, '/'));
    }
    return [...files].slice(0, 6);
  }
}

/** Pull useful search terms out of a natural-language request. */
export function extractSearchHints(message: string): string[] {
  const terms: string[] = [];

  // Explicitly quoted identifiers are the strongest signal.
  for (const match of message.matchAll(/["'`]([A-Za-z0-9_.$-]{3,60})["'`]/g)) terms.push(match[1]);

  // Independent patterns, tried in order of signal strength. Using one combined
// alternation breaks "Find where authentication is": the `find` branch matches
// first and captures the word "where".
const patterns = [
  // "where authentication is implemented"
  /\bwhere\s+(?:is\s+|are\s+)?(?:the\s+)?([A-Za-z][A-Za-z0-9_]{2,30})\b/i,
  // "find the login handler"
  /\b(?:find|locate|search for|grep|about|regarding)\s+(?:the\s+|a\s+|an\s+)?([A-Za-z][A-Za-z0-9_]{2,30})\b/i,
  // "fix the login bug"
  /\b(?:fix|repair|add|change|update)\s+(?:the\s+)?([A-Za-z][A-Za-z0-9_]{2,30})\s+(?:bug|issue|error|function|method|handler|feature)/i,
];
for (const pattern of patterns) {
  const match = pattern.exec(message);
  if (match && !STOP_TERMS.has(match[1].toLowerCase())) terms.push(match[1]);
}

  return [...new Set(terms)].slice(0, 4);
}

const STOP_TERMS = new Set([
  'failing', 'tests', 'test', 'project', 'repo', 'repository', 'bug', 'issue', 'error',
  'problem', 'please', 'thank', 'where', 'find', 'locate', 'search', 'grep', 'about',
  'the', 'this', 'that', 'implemented', 'defined', 'used', 'handled', 'located',
]);

/**
 * Build a minimal, dependency-free project scaffold.
 *
 * Declares the requested stack and pins the proposed package ranges, but
 * never installs them. The resulting files remain an unbuilt scaffold until
 * Karl separately approves executable dependency installation.
 */
export function buildScaffold(name: string, stack: readonly string[]): Record<string, string> {
  const isTs = stack.includes('TypeScript');
  const isReact = stack.includes('React');
  const files: Record<string, string> = {
    'README.md': `# ${name}\n\nLocal scaffold created by Astra. Dependencies are declared but not installed. Review package versions and approve installation separately before running the app.\n`,
    '.gitignore': 'node_modules/\ndist/\n*.log\n',
  };
  if (isReact && isTs) {
    files['package.json'] = `${JSON.stringify({
      name: name.toLowerCase(), version: '0.1.0', private: true, type: 'module',
      scripts: { dev: 'vite', build: 'tsc --noEmit && vite build', preview: 'vite preview' },
      dependencies: { react: '^19.3.0', 'react-dom': '^19.3.0' },
      devDependencies: { '@types/react': '^19.3.0', '@types/react-dom': '^19.3.0', typescript: '^6.0.3', vite: '^8.3.4' },
    }, null, 2)}\n`;
    files['index.html'] = '<!doctype html>\n<html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>' + name + '</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>\n';
    files['tsconfig.json'] = `${JSON.stringify({ compilerOptions: { target: 'ES2022', lib: ['ES2022', 'DOM'], module: 'ESNext', moduleResolution: 'bundler', jsx: 'react-jsx', strict: true, noEmit: true, skipLibCheck: true }, include: ['src'] }, null, 2)}\n`;
    files['src/main.tsx'] = "import React from 'react';\nimport { createRoot } from 'react-dom/client';\nimport { App } from './App';\nimport './style.css';\n\ncreateRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);\n";
    files['src/App.tsx'] = `export function App() {\n  return <main><h1>${name}</h1><p>Your dashboard is ready to build.</p></main>;\n}\n`;
    files['src/style.css'] = 'body { margin: 0; font-family: system-ui, sans-serif; color: #eef; background: #151827; }\nmain { max-width: 72rem; margin: 4rem auto; padding: 1rem; }\n';
    return files;
  }
  files['package.json'] = `${JSON.stringify({ name: name.toLowerCase(), version: '0.1.0', private: true, type: 'module', scripts: { test: 'node --test' } }, null, 2)}\n`;
  files[isTs ? 'src/index.ts' : 'src/index.js'] = `export const projectName = ${JSON.stringify(name)};\n`;
  return files;
}
