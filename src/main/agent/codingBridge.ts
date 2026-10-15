import {
  extractNewRepositoryName,
  extractAbsoluteFilePath,
  extractRepositoryHint,
  extractStackHints,
  normaliseDirectoryName,
  routeCodingIntent,
  type CodingIntent,
} from './codingIntent';
import type { CodingAgent, TaskSnapshot, ToolEvent } from './codingAgent';
import { discoverRepositories, readProjectFile, searchProjectCode, describeProject, listProjectFiles } from '../workspace/repoTools';
import { resolveWithinRootNotRoot, type SandboxOptions } from '../workspace/pathGuard';
import { existsSync, lstatSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { proposeCodingPatch, proposeFileContent, proposeProjectFiles, type ModelProposal } from './codingModel';
import { analyseProjectRequest, buildProjectScaffold, validateGeneratedFiles } from './projectBuild';
import { verifyReactApplication } from './applicationVerification';
import { SEPARATE_APPROVAL_EXPLANATIONS } from '../workspace/projectAuthority';
import { inspectLocalService, inspectPath } from '../workspace/verification';
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
    private readonly projectProposer: typeof proposeProjectFiles = proposeProjectFiles,
  ) {}

  onActivity(listener: (event: ToolEvent, snapshot: TaskSnapshot) => void): () => void {
    return this.agent.onActivity((event) => listener(event, this.agent.snapshot()));
  }

  /**
   * Handle one user message. Returns null when this is ordinary conversation
   * and the chat model should answer instead.
   */
  async handle(message: string, cancellation?: AbortSignal): Promise<ChatToolResult | null> {
    const current = this.agent.snapshot();
    if (/^\s*(?:approve|yes,?\s*(?:go ahead|do it)|permission granted)\s*[.!]?\s*$/i.test(message) && current.phase === 'awaiting_approval') {
      return { reply: `The plan for ${current.objective} still needs approval through Astra's Approve plan control. This chat message does not grant file or command authority.`, handled: true, snapshot: current };
    }
    if (this.isProjectContinuation(message, current)) return this.continueProject(current);
    if (this.isApplicationBuildRequest(message)) return this.proposeApplication(message, cancellation);
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
      case 'check_path':
        return this.checkPath(intent);
      case 'check_repository':
        return this.checkRepository(intent);
      case 'check_service':
        return this.checkService(intent);
      case 'read_file':
        return this.readFile(message);
      case 'create_file':
      case 'write_file':
      case 'edit_file':
      case 'delete_file':
        return this.proposeFileOperation(intent.kind.replace('_file', '') as DirectFileAction, message, cancellation);
      case 'create_directory':
      case 'delete_directory':
        return this.proposeDirectoryOperation(intent.kind === 'create_directory' ? 'create_directory' : 'delete_directory', message, cancellation);
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
      const tests = described.testCommands.length ? `, tests: ${described.testCommands.join(', ')}` : '';
      return `- **${repo.name}** — ${repo.root} (${described.detectedLanguages.join(', ') || 'language unknown'}${tests})`;
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
    if (this.isExecuting()) return { reply: 'The approved coding workflow is still running. Its changes and activity are visible in Coding when the command finishes.', handled: true };
    const snapshot = this.agent.snapshot();
    if (!snapshot.plan) return { reply: 'There is no coding task to review.', handled: true };
    if (!snapshot.changes.length) return { reply: 'This task has not changed any files.', handled: true, snapshot };
    return {
      reply: `Recorded changes in ${snapshot.plan.repository}:\n${snapshot.changes.map((change) => `- ${change.action}: ${change.file ?? 'project'}`).join('\n')}\n\nSee the approved patch and exact new-file content in Coding.`,
      handled: true,
      snapshot,
    };
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

  // ---------------------------------------------------------- verification

  /**
   * Resolve the subject of an existence question.
   *
   * The spoken name is never trusted as a path: it is matched against what was
   * actually discovered under the approved root, and only a real discovered
   * path (or an absolute path that passes the containment check) is inspected.
   * Anything else is reported as unresolvable rather than invented.
   */
  private resolveClaimSubject(intent: CodingIntent): { target: string; label: string } | { unresolved: string } {
    const named = intent.path ?? intent.repositoryName;
    if (intent.path) return { target: intent.path, label: intent.path };

    const repos = discoverRepositories(this.sandbox);
    const discovered = repos.slice(0, 20).map((r) => r.name).join(', ');

    if (named) {
      const wanted = named.toLowerCase();
      const match = repos.find((r) => r.name.toLowerCase() === wanted)
        ?? repos.find((r) => r.name.toLowerCase().includes(wanted))
        ?? repos.find((r) => wanted.includes(r.name.toLowerCase()));
      if (match) return { target: match.root, label: match.name };
      return { unresolved: `Astra found no directory called "${named}" under ${this.sandbox.root}.${discovered ? ` Discovered repositories: ${discovered}.` : ' No repositories were discovered there.'} Astra has not created anything.` };
    }

    const repository = this.agent.getRepository();
    if (repository) return { target: repository, label: repository };

    // "the blog project" names no directory. With exactly one project under the
    // root the answer is unambiguous; with several, Astra asks rather than
    // guessing which one was meant.
    if (repos.length === 1) return { target: repos[0].root, label: repos[0].name };
    if (repos.length === 0) {
      return { unresolved: `There are no projects under ${this.sandbox.root}, so there is nothing there to check. Astra has not created anything.` };
    }
    return { unresolved: `Astra cannot tell which project to inspect. Projects under ${this.sandbox.root}: ${discovered}. Name one, or ask to list the repositories.` };
  }

  /**
   * Report what the filesystem actually shows for a path.
   *
   * "No" is the expected answer far more often than Astra's old behaviour
   * assumed, and saying so plainly is the point.
   */
  private async checkPath(intent: CodingIntent): Promise<ChatToolResult> {
    const subject = this.resolveClaimSubject(intent);
    if ('unresolved' in subject) return { reply: subject.unresolved, handled: true };

    const inspection = inspectPath(subject.target, this.sandbox, null);

    if (inspection.unavailable) {
      return { reply: `${inspection.unavailable} Astra has not verified anything about "${subject.label}".`, handled: true };
    }
    if (!inspection.exists) {
      return {
        reply: `**Verified: it does not exist.**\n\nAstra checked \`${inspection.target}\` on disk and found nothing there. Astra has not created it, and nothing was changed.`,
        handled: true,
      };
    }

    const kind = inspection.kind === 'directory' ? 'directory' : inspection.kind === 'file' ? 'file' : 'special entry';
    const parts = [
      `**Verified on disk**`,
      `- Path: \`${inspection.target}\``,
      `- Exists: yes — it is a ${kind}`,
      // Git is stated only because a `.git` entry was actually found.
      `- Git repository: ${inspection.isGitRepository ? `yes${inspection.branch ? ` (branch ${inspection.branch})` : ''}` : 'no — there is no .git entry here'}`,
      inspection.entries.length ? `- Contents: ${inspection.entries.join(', ')}${inspection.entries.length >= 40 ? ', …' : ''}` : '',
    ].filter(Boolean);
    return { reply: parts.join('\n'), handled: true };
  }

  /** Answer "is this a repository?" from Git metadata, never from its name. */
  private async checkRepository(intent: CodingIntent): Promise<ChatToolResult> {
    const subject = this.resolveClaimSubject(intent);
    if ('unresolved' in subject) return { reply: subject.unresolved, handled: true };

    const inspection = inspectPath(subject.target, this.sandbox);
    if (inspection.unavailable) return { reply: `${inspection.unavailable} Astra cannot say whether "${subject.label}" is a Git repository.`, handled: true };
    if (!inspection.exists) {
      return { reply: `**Verified: it does not exist.** \`${inspection.target}\` is not on disk, so it cannot be a Git repository. Astra has not created it.`, handled: true };
    }

    if (!inspection.isGitRepository) {
      return {
        reply: `**Verified: no.** \`${inspection.target}\` exists but has no \`.git\` entry, so Astra cannot call it a Git repository. Astra has not run \`git init\` and nothing was changed.`,
        handled: true,
      };
    }
    return {
      reply: `**Verified: yes.** \`${inspection.target}\` has a .git entry.`,
      handled: true,
    };
  }

  /**
   * Probe a local service.
   *
   * Astra opens a real socket. It never asserts that a URL is live because a
   * project was created, and it refuses to start servers, which it has no tool
   * to do — that limitation is stated rather than papered over.
   */
  private async checkService(intent: CodingIntent): Promise<ChatToolResult> {
    const address = intent.serviceUrl;
    if (!address) {
      return {
        reply: 'Astra cannot check that address. Give it as a loopback address such as http://localhost:3000 and Astra will open a connection and report what it finds.',
        handled: true,
      };
    }

    const service = await inspectLocalService(address);
    if (service.unavailable) {
      return { reply: `${service.unavailable}\n\nAstra has not started a web server or served a URL.`, handled: true };
    }
    return {
      reply: `**Verified: something accepted a connection on ${service.host}:${service.port}.** Astra completed a real TCP connection to ${service.url}. That proves the port is listening; it does not prove which application is behind it, and Astra did not start it.`,
      handled: true,
    };
  }

  // ------------------------------------------------------------- mutating

  private isApplicationBuildRequest(message: string): boolean {
    const request = analyseProjectRequest(message, null);
    return request.buildsApplication && request.stack.includes('React')
      && /\b(?:blog|website|site|app|application|project)\b/i.test(message);
  }

  private isProjectContinuation(message: string, snapshot: TaskSnapshot): boolean {
    if (!snapshot.plan?.project && !snapshot.plan?.application) return false;
    return /^\s*(?:continue|resume|finish(?: the (?:website|site|blog|project|repo))?|just finish it|build the whole (?:repo|project)|keep going)(?:[.!\s].*)?$/i.test(message);
  }

  private async continueProject(snapshot: TaskSnapshot): Promise<ChatToolResult> {
    if (snapshot.requiresConfirmation && snapshot.plan) {
      this.agent.fail('The interrupted project requires a fresh inspected workspace plan; no prior authority was reused.');
      return this.proposeApplication(snapshot.plan.objective);
    }
    if (snapshot.phase === 'awaiting_approval') return {
      reply: `The project objective is still ${snapshot.objective}. The scoped plan is awaiting approval in Astra's visible Coding workspace. A chat message does not grant authority.`,
      handled: true, snapshot,
    };
    if (['implementing', 'testing', 'reviewing', 'investigating', 'planning'].includes(snapshot.phase)) return {
      reply: `The approved project task is still ${snapshot.phase}. Astra will continue its permitted work and report the verified result.`,
      handled: true, snapshot,
    };
    if (snapshot.phase === 'paused') return {
      reply: 'The project task was interrupted. Resume it through the Coding workspace confirmation so Astra can recheck the same approved scope before acting.',
      handled: true, snapshot,
    };
    if (snapshot.phase === 'failed') {
      const target = snapshot.plan?.application?.root ?? snapshot.plan?.project?.root;
      if (target && existsSync(target) && snapshot.plan) return this.proposeApplication(snapshot.plan.objective);
      return { reply: `The previous project task failed: ${snapshot.error ?? 'no verified completion'}. The destination is absent; ask Astra to propose a fresh plan.`, handled: true, snapshot };
    }
    if (snapshot.phase === 'completed' && snapshot.plan?.application) {
      const gate = verifyReactApplication(snapshot.plan.application.root, snapshot.plan.application.manifest);
      const buildPassed = snapshot.testResults.some((result) => result.ok && /npm run build/.test(result.command));
      return { reply: gate.issues.length === 0 && buildPassed
        ? `The React application is verified on disk at ${snapshot.plan.application.root}; its approved build passed. Run \`${snapshot.plan.application.launchCommand}\` from that directory. Astra has not started a server.`
        : `The project task has a completion record, but the React application is not currently verified: ${[...gate.issues, ...(!buildPassed ? ['no passing approved build is recorded'] : [])].join('; ')}`,
      handled: true, snapshot };
    }
    return { reply: `The project task is ${snapshot.phase}. ${snapshot.buildReport?.validated ? 'Its recorded validation passed.' : 'A complete, runnable application has not been verified.'}`, handled: true, snapshot };
  }

  /** Route whole-application work before generic path inspection or chat. */
  private async proposeApplication(message: string, cancellation?: AbortSignal): Promise<ChatToolResult> {
    if (['investigating', 'planning', 'awaiting_approval', 'implementing', 'testing', 'reviewing'].includes(this.agent.snapshot().phase)) {
      return { reply: 'The current coding plan remains active. Review its state in Coding; Astra will not replace its approved scope from chat.', handled: true, snapshot: this.agent.snapshot() };
    }
    const spokenPath = extractAbsoluteFilePath(message);
    const rawName = spokenPath ? path.basename(spokenPath) : extractNewRepositoryName(message);
    if (!rawName) return { reply: 'Name the React project or give its exact directory under the approved workspace root.', handled: true };
    const wantedName = rawName.toLowerCase();
    const existing = spokenPath ? undefined : readdirSync(this.sandbox.root, { withFileTypes: true })
      .find((entry) => entry.name.toLowerCase() === wantedName && entry.isDirectory());
    const name = spokenPath ? rawName : existing?.name ?? normaliseDirectoryName(rawName);
    if (!name) return { reply: `The project name "${rawName}" is not a safe directory name.`, handled: true };
    let target: string;
    try {
      target = resolveWithinRootNotRoot(spokenPath ?? path.join(this.sandbox.root, name), this.sandbox);
      if (path.dirname(target).toLowerCase() !== path.resolve(this.sandbox.root).toLowerCase()) throw new Error('a project build must target a direct child of the approved workspace root');
    } catch (error) {
      return { reply: `Astra cannot plan that project path: ${error instanceof Error ? error.message : String(error)}`, handled: true };
    }
    const request = analyseProjectRequest(message, name);
    if (!existsSync(target)) return this.proposeProjectBuild(message, name, target, request);
    if (!lstatSync(target).isDirectory()) return { reply: `${target} is not a real directory; Astra will not write through a file or link.`, handled: true };
    return this.proposeExistingApplication(message, name, target, request, cancellation);
  }

  private async proposeExistingApplication(message: string, name: string, target: string, request: ReturnType<typeof analyseProjectRequest>, cancellation?: AbortSignal): Promise<ChatToolResult> {
    const baseline = buildProjectScaffold(name, request.kind, request.stack);
    const manifest = Object.keys(baseline);
    try {
      for (const file of manifest) resolveWithinRootNotRoot(path.join(target, file), { root: target });
    } catch (error) {
      return { reply: `Astra refused this workspace plan because a required React path crosses a link or leaves the project: ${error instanceof Error ? error.message : String(error)}`, handled: true };
    }
    const missing = manifest.filter((file) => !existsSync(path.join(target, file)));
    const existing = readdirSync(target, { withFileTypes: true }).map((entry) => entry.name);
    if (missing.length === 0 && !existsSync(path.join(target, 'node_modules', 'vite'))) return {
      reply: `The React source files are present in ${target}, but the project remains incomplete: dependencies are unavailable and the build has not passed. Dependency installation needs separate approval; Astra has not overwritten any existing file.`,
      handled: true,
    };
    const source = missing.filter((file) => file.startsWith('src/') && /\.(?:ts|tsx|css)$/.test(file));
    let generated: Record<string, string>;
    try {
      generated = source.length ? await this.projectProposer(request.purpose, source, fetch, cancellation, request.stack, manifest) : {};
    } catch (error) {
      if (cancellation?.aborted) throw error;
      const reason = `The local coding model could not prepare the missing React source: ${error instanceof Error ? error.message : String(error)}`;
      await this.agent.beginTask({
        objective: message.trim(), repository: target, proposedFiles: [], proposedWrites: [], proposedCommands: [],
        application: { root: target, manifest, launchCommand: 'npm run dev', stack: request.stack },
        rootCause: 'The requested project directory exists but the model proposal failed before any write.',
        expectedOutcome: 'Retry the same objective with a validated, reviewable missing-file plan.', risks: [reason],
      });
      const failed = this.agent.fail(reason);
      return { reply: `${reason}. The objective is retained for “Continue”; no file was changed or approved.`, handled: true, snapshot: failed };
    }
    const writes = missing.map((file) => ({ file, content: generated[file] ?? baseline[file] }));
    const snapshot = await this.agent.beginTask({
      objective: message.trim(), repository: target, proposedFiles: missing, proposedWrites: writes,
      proposedCommands: [{ executable: 'npm', args: ['run', 'build'], purpose: 'Validate the completed React application when dependencies are available' }],
      application: { root: target, manifest, launchCommand: 'npm run dev', stack: request.stack },
      rootCause: 'The requested project directory exists but lacks a complete React application.',
      expectedOutcome: `${target} contains the React application and npm run build passes when dependencies are available.`,
      risks: ['Only missing files will be created. Existing files, including unrelated work, will not be overwritten.', 'Dependency installation is outside this approval.'],
    });
    return {
      reply: `**Existing React project plan** for \`${target}\`. Found: ${existing.join(', ') || 'empty directory'}. Missing files to create: ${missing.join(', ') || 'none; this plan validates the existing application'}. ${source.length} source/style files were drafted by the local coding model. The exact file contents and one npm build command are in Coding for review. Existing files will be preserved. Approve the scoped plan in the visible app; chat permission alone does not grant authority. Dependencies remain separate.`,
      handled: true, snapshot,
    };
  }

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
    const newFile = intent.kind === 'add_feature' ? this.inferNewReactFile(repository, message) : null;
    if (proposedFiles.length === 0 && !newFile) {
      return { reply: 'I could not identify a specific source file. Please name the failing test, function, or file so I can investigate safely.', handled: true };
    }
    if (path.basename(repository).toLowerCase() === 'astra' && proposedFiles.some((file) => /(^|\/)(approvals|pathGuard|commandRunner|codingAgent|codingBridge|codingModel|intelligenceService)(\/|\.|$)/i.test(file))) {
      return { reply: 'This request touches Astra’s coding security boundary. It needs separate owner authorisation before Astra can propose an edit to those files.', handled: true };
    }
    let model: ModelProposal | null = null;
    let writes: { file: string; content: string }[] = [];
    this.agent.setInvestigatingProposal(true);
    try {
      if (newFile) {
        const context = proposedFiles.slice(0, 2).map((file) => ({ file, content: readProjectFile(path.join(repository, file), { root: repository }, { maxBytes: 6000 }).text }));
        const content = await this.fileProposer(message.trim(), path.join(repository, newFile), null, context, fetch, cancellation);
        writes = [{ file: newFile, content: validateGeneratedFiles({ [newFile]: content }, [newFile], ['react', 'react-dom'])[newFile] }];
      }
      if (proposedFiles.length > 0 && (!newFile || /page$/i.test(path.basename(newFile, path.extname(newFile))))) {
        const ordered = newFile ? [...proposedFiles].sort((a, b) => Number(/App\.(tsx|jsx)$/.test(b)) - Number(/App\.(tsx|jsx)$/.test(a))) : proposedFiles;
        model = await this.proposer(newFile ? `${message.trim()} Integrate the new ${newFile} module into the existing application.` : message.trim(), repository, ordered, this.sandbox, fetch, cancellation);
      }
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
      proposedFiles: [...(model?.patches.map((patch) => patch.file) ?? []), ...writes.map((write) => write.file)],
      proposedPatches: model?.patches ?? [],
      proposedWrites: writes,
      proposedCommands,
      rootCause: model?.rootCause ?? 'A new component was requested.',
      expectedOutcome: model?.expectedOutcome ?? `${newFile} contains the requested component.`,
      risks: model?.risks ?? ['The new component must be reviewed before it is used elsewhere.'],
      branch: null,
    });

    const plan = snapshot.plan;
    if (!plan) return { reply: 'Astra could not produce a plan for that request.', handled: true, snapshot };

    const lines = [
      `I'll investigate this in **${plan.repository}** and propose a bounded change.`,
      '',
      `**Objective:** ${plan.objective}`,
      plan.rootCause ? `**Assessment:** ${plan.rootCause}` : null,
      `**Files to change:** ${plan.filesToChange.join(', ')}`,
      writes.length ? `**New file content:**\n\`\`\`\n${writes.map((write) => `${write.file}\n${write.content}`).join('\n')}\n\`\`\`` : null,
      `**Commands proposed:** ${plan.commands.length ? plan.commands.map((c) => `${c.executable} ${c.args.join(' ')}`).join(', ') : 'none'}`,
      `**Expected outcome:** ${plan.expectedOutcome}`,
      `**Risks:** ${plan.risks.join(' ')}`,
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
    const rawName = extractNewRepositoryName(message);
    if (!rawName) {
      return { reply: 'What should the new repository be called? For example: "create a React and TypeScript dashboard called MyDashboard".', handled: true };
    }
    // Karl asked that names be joined up rather than loosened, so "Astra's Blog"
    // is offered as `AstrasBlog`. The safe-name rule is unchanged: only letters
    // and digits can survive, so no separator or traversal can either.
    const normalised = normaliseDirectoryName(rawName);
    if (!normalised) {
      return { reply: `"${rawName}" cannot be used as a repository name. Astra joins the words into one safe name (for example "Astra's Blog" becomes "AstrasBlog") and refuses Windows device names.`, handled: true };
    }
    const name = normalised;
    const renamed = normalised !== rawName ? `- Name as spoken: **${rawName}**, folded to **${normalised}** so it is a single safe directory name` : null;
    const target = path.join(this.sandbox.root, name);
    const request = analyseProjectRequest(message, name);
    if (request.buildsApplication) return this.proposeProjectBuild(message, name, target, request);

    const stack = extractStackHints(message);
    const scaffold = buildScaffold(name, stack);
    // Astra can create files. It has no tool that
    // launches a process, so a request that also names a URL or a port is
    // answered honestly here instead of being allowed to imply a running site.
    const asksForService = /\bhttps?:\/\/|\blocalhost\b|\b127\.0\.0\.1\b|\bport\s+\d{2,5}\b|\b(?:dev|development|preview|web)\s+server\b/i.test(message);

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
      ...(renamed ? [renamed] : []),
      `- Stack: ${stack.length ? stack.join(', ') : 'plain Node.js'}`,
      `- Files that would be created: ${Object.keys(scaffold).join(', ')}`,
      `- Availability: ${available ? 'destination is free' : `NOT AVAILABLE - ${reason}`}`,
      '',
      '**Dependency installation is currently blocked.** Package managers run arbitrary lifecycle scripts, so Astra will not run `npm install` or fetch remote packages. The scaffold will be created without installed dependencies, and Karl will need to install them manually.',
      ...(asksForService ? ['', '**Astra cannot start a web server.** Run the dev server yourself, then ask Astra to check the address.'] : []),
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
      expectedOutcome: `${name} exists at ${target} with the listed scaffold files.`,
      risks: ['Dependencies are declared but not installed. Install and build remain unverified until separately approved.'],
    });
    return { reply: lines.join('\n'), handled: true, snapshot };
  }

  /**
 * Propose a whole working project under one approval.
 *
 * The plan is the contract Karl sees: the absolute destination, what the
 * project is for, the stack preference, every file Astra intends to create, the
 * commands she intends to run, and the exact limits of what the approval
 * permits. Nothing is created before he approves it.
 */
  private async proposeProjectBuild(message: string, name: string, target: string, request: ReturnType<typeof analyseProjectRequest>): Promise<ChatToolResult> {
    if (['investigating', 'planning', 'awaiting_approval', 'implementing', 'testing', 'reviewing'].includes(this.agent.snapshot().phase)) {
      return { reply: 'A coding task is already in progress. Finish, reject or cancel it before starting another.', handled: true };
    }
    if (existsSync(target)) {
      return { reply: `**Destination is not available.**\n\n\`${target}\` already exists, so Astra will not create or overwrite it. Choose a different name.`, handled: true };
    }

    const baseline = buildProjectScaffold(name, request.kind, request.stack);
    const manifest = Object.keys(baseline);
    const directories = [...new Set(manifest.map((file) => file.slice(0, Math.max(0, file.lastIndexOf('/')))).filter(Boolean))];
    // Validation is real: a syntax check per source file, then the test suite.
    const sourceFiles = manifest.filter((file) => /\.js$/.test(file) && !file.startsWith('test/')).slice(0, 8);
    const commands = request.stack.includes('React')
      ? [{ executable: 'npm', args: ['run', 'build'], purpose: 'Build the React application when dependencies are available' }]
      : [
      ...sourceFiles.map((file) => ({ executable: 'node', args: ['--check', file], purpose: `Check ${file} parses` })),
      { executable: 'node', args: ['--test'], purpose: 'Run the project test suite' },
    ].slice(0, request.limits.maxCommands);

    const launchCommand = request.stack.includes('React') ? 'npm run dev' : request.kind === 'blog' ? 'node src/server.js' : 'node src/index.js';

    const lines = [
      `**Proposed project build**`,
      '',
      `- Absolute destination: \`${target}\``,
      `- Purpose: ${request.purpose}`,
      `- Kind: ${request.kind}`,
      `- Stack: ${request.stack.includes('React') ? 'React, TypeScript and Vite' : request.stack.length ? request.stack.join(', ') : 'plain Node.js, no dependencies'}`,
      `- Directories to create: ${directories.length ? directories.join(', ') : 'the project root only'}`,
      `- Files to create (${manifest.length}): ${manifest.join(', ')}`,
      `- Commands to run (${commands.length}): ${commands.map((c) => `${c.executable} ${c.args.join(' ')}`).join('; ')}`,
      '',
      '**What this approval permits**',
      `- Writing any file under \`${target}\` only, up to ${request.limits.maxWrites} writes.`,
      `- Running only the ${commands.length} command(s) listed above, up to ${request.limits.maxCommands} runs and ${Math.round(request.limits.deadlineMs / 1000)} seconds.`,
      '- The local coding model may draft application files inside the manifest; its output is validated and rejected if it fails.',
      '',
      '**What still needs separate approval**',
      `- ${SEPARATE_APPROVAL_EXPLANATIONS.delete}`,
      `- ${SEPARATE_APPROVAL_EXPLANATIONS.dependency_install}`,
      '- Network access, credentials, and anything outside this directory.',
      '',
      `**After approval Astra will** create the directory, write and verify every file, run available validation commands, and repair failures within this scope up to ${request.limits.maxIterations} pass(es).`,
      '',
      `**Launch it yourself with** \`${launchCommand}\` — Astra does not start servers.`,
      '',
      'Nothing has been created yet. Approve this plan in Coding, or tell Astra to cancel.',
    ];

    const snapshot = await this.agent.beginTask({
      objective: message.trim(),
      project: {
        name,
        root: target,
        kind: request.kind,
        purpose: request.purpose,
        stack: request.stack,
        directories,
        manifest,
        baseline,
        commands,
        limits: request.limits,
        launchCommand,
      },
      proposedFiles: manifest,
      expectedOutcome: `${target} exists with the listed files; available validation commands pass.`,
      rootCause: 'Karl asked for a project to be built from one request.',
      risks: [
        request.stack.includes('React') ? 'React dependencies are declared but not installed; the build requires a separately approved installation or existing dependencies.' : 'This project runs on the installed Node.js without dependencies.',
        `The build is bounded to ${request.limits.maxIterations} validation pass(es), ${request.limits.maxWrites} writes and ${Math.round(request.limits.deadlineMs / 1000)}s.`,
      ],
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

  /**
   * Resolve the directory a request names, folding the name into one safe form.
   *
   * Karl asked that names be joined up rather than loosened: "Astra's Blog"
   * becomes `AstrasBlog`. Normalisation happens only for creation, where there
   * is nothing to overwrite and the final component is ours to choose; a
   * deletion must address the directory that actually exists.
   */
  private resolveDirectoryTarget(message: string, action: 'create_directory' | 'delete_directory'): { target: string; renamed?: { from: string; to: string } } | { unresolved: string } {
    // Read to a sentence boundary: a directory name may contain a space, and
    // the component is normalised on create anyway. Over-reading fails safely,
    // because the plan refuses a directory that is not there.
    const absolute = extractAbsoluteFilePath(message, 'sentence');
    if (absolute) {
      const base = path.basename(absolute);
      if (action === 'delete_directory') return { target: absolute };
      const name = normaliseDirectoryName(base);
      if (!name) return { unresolved: `"${base}" cannot be used as a directory name. Astra joins words into one safe name (for example "My Blog" becomes "MyBlog") and refuses Windows device names.` };
      return {
        target: path.join(path.dirname(absolute), name),
        renamed: name === base ? undefined : { from: base, to: name },
      };
    }

    const spoken = extractNewRepositoryName(message);
    if (!spoken) return { unresolved: 'Which directory should Astra use? Give an absolute path under the approved root, or say "create a folder called Name".' };
    const name = normaliseDirectoryName(spoken);
    if (!name) return { unresolved: `"${spoken.trim()}" cannot be used as a directory name. Astra joins words into one safe name (for example "Astra's Blog" becomes "AstrasBlog") and refuses Windows device names.` };
    return {
      target: path.join(this.sandbox.root, name),
      renamed: name === spoken.trim() ? undefined : { from: spoken.trim(), to: name },
    };
  }

  /**
   * Propose creating or removing a directory through the ordinary approval path.
   *
   * Nothing happens until Karl approves, and a recursive delete shows the exact
   * manifest of what would go, because it cannot be undone.
   */
  private async proposeDirectoryOperation(action: 'create_directory' | 'delete_directory', message: string, cancellation?: AbortSignal): Promise<ChatToolResult> {
    if (['investigating', 'planning', 'awaiting_approval', 'implementing', 'testing', 'reviewing'].includes(this.agent.snapshot().phase)) {
      return { reply: 'A coding task is already in progress. Finish, reject or cancel it before starting another.', handled: true };
    }
    if (cancellation?.aborted) throw new Error('directory request cancelled');

    const resolved = this.resolveDirectoryTarget(message, action);
    if ('unresolved' in resolved) return { reply: resolved.unresolved, handled: true };

    try {
      const operation = planDirectFileAction(resolved.target, this.sandbox, action);
      const renamed = resolved.renamed
        ? `Astra folded the name **${resolved.renamed.from}** into **${resolved.renamed.to}**, so it is a single safe directory name.`
        : null;
      const lines = action === 'create_directory'
        ? [
          '**Proposed directory create**',
          `- Absolute path: \`${operation.target}\``,
          `- Parent directory: ${operation.createParent ? 'will be created after approval' : 'exists'}`,
          '- Contents: the directory is created empty; no file is written',
          '- Git: none will be created',
          ...(renamed ? ['', renamed] : []),
          '',
          'Nothing has been changed. Approve this exact operation in Coding to create the directory.',
        ]
        : [
          '**Proposed directory delete — this cannot be undone**',
          `- Absolute path: \`${operation.target}\``,
          `- Everything inside will be removed: **${operation.entryCount} entr${operation.entryCount === 1 ? 'y' : 'ies'}**`,
          ...(operation.containsGit ? ['- **This directory contains Git metadata (`.git`). Deleting it removes the repository history.**'] : []),
          '',
          'Full listing of what will be removed:',
          '```',
          ...(operation.entries ?? []).map((entry) => `  ${entry}`),
          '```',
          ...(renamed ? ['', renamed] : []),
          '',
          'Nothing has been changed. Approve this exact operation in Coding to delete it, or reject to keep everything.',
        ];
      const snapshot = await this.agent.beginTask({
        objective: message.trim(),
        fileOperation: operation,
        proposedFiles: [path.basename(operation.target)],
        expectedOutcome: operation.action === 'delete_directory'
          ? `${operation.target} and its ${operation.entryCount} listed entr${operation.entryCount === 1 ? 'y' : 'ies'} are absent after an independent filesystem check.`
          : `${operation.target} exists as an empty directory after an independent filesystem check.`,
        rootCause: 'Karl requested a direct directory operation.',
        risks: [operation.action === 'delete_directory'
          ? 'Recursive deletion is permanent. Every removed path is listed in this plan for review.'
          : 'The directory is created after approval; it starts empty.'],
      });
      return { reply: lines.join('\n'), handled: true, snapshot };
    } catch (error) {
      return { reply: `I could not propose ${action === 'create_directory' ? 'creating' : 'deleting'} a directory at ${resolved.target}: ${error instanceof Error ? error.message : String(error)}. Nothing was changed.`, handled: true };
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

  private inferNewReactFile(repository: string, message: string): string | null {
    const match = /\b(?:add|create|build|implement)\s+(?:a|an|the)\s+([A-Za-z][A-Za-z0-9 ]{0,40}?)\s+(component|page)\b/i.exec(message);
    if (!match) return null;
    const files = listProjectFiles(repository, { root: repository }, { maxEntries: 150, maxDepth: 4 });
    const extension = files.some((file) => file.relativePath.endsWith('.tsx')) ? 'tsx'
      : files.some((file) => file.relativePath.endsWith('.jsx')) ? 'jsx' : null;
    if (!extension) return null;
    const name = match[1].trim().split(/\s+/).map((part) => part[0].toUpperCase() + part.slice(1)).join('');
    const file = match[2].toLowerCase() === 'page' ? `src/pages/${name}Page.${extension}` : `src/components/${name}.${extension}`;
    return existsSync(path.join(repository, file)) ? null : file;
  }

  /** Read the project's own test script rather than guessing one. */
  private async detectTestCommand(repository: string): Promise<{ executable: string; args: readonly string[] } | null> {
    try {
      const read = readProjectFile(`${repository}\\package.json`, { root: repository }, { maxBytes: 100_000 });
      const parsed = JSON.parse(read.text) as { scripts?: Record<string, string> };
      const test = parsed.scripts?.test;
      if (typeof test === 'string' && test.trim()) {
        return { executable: 'npm', args: ['test'] };
      }
      if (typeof parsed.scripts?.build === 'string' && parsed.scripts.build.trim()) return { executable: 'npm', args: ['run', 'build'] };
    } catch {
      // Not a Node project, or unreadable; no command is proposed.
    }
    if (existsSync(path.join(repository, 'artisan')) && existsSync(path.join(repository, 'vendor', 'autoload.php'))) {
      return { executable: 'php', args: ['artisan', 'test'] };
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
