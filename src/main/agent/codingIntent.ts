/**
 * Natural-language coding intent routing.
 *
 * This module decides what Karl *asked for*, and nothing else. It never
 * decides what is permitted: an intent is a request, which must still pass
 * approval before anything happens. That separation matters, because the
 * alternative — letting a classifier decide authority — is how a phrase like
 * "just push it" turns into an unauthorized action.
 *
 * Two design rules:
 *
 *  1. Prefer an explicit, narrow intent over a model guess. If the text is
 *     ambiguous, return `unclear` and ask, rather than guessing and acting.
 *  2. Extracted entities (repository names, search terms) are validated
 *     against a strict pattern. They are later re-resolved inside the
 *     sandbox, so a hostile name cannot escape even if it gets through here.
 */

/** What a message is asking Astra to do. */
export type CodingIntentKind =
  | 'list_repositories'
  | 'select_repository'
  | 'explain_project'
  | 'find_code'
  | 'investigate_tests'
  | 'fix_bug'
  | 'add_feature'
  | 'create_repository'
  | 'read_file'
  | 'create_file'
  | 'write_file'
  | 'edit_file'
  | 'delete_file'
  | 'run_tests'
  | 'show_changes'
  | 'cancel_task'
  | 'chitchat';

export interface CodingIntent {
  readonly kind: CodingIntentKind;
  /** Repository the request names, if any, normalised. Never trusted as a path. */
  readonly repositoryName: string | null;
  /** Free-text search term for `find_code`. */
  readonly searchTerm: string | null;
  /** Human-readable echo used to confirm understanding before acting. */
  readonly interpretedAs: string;
  /** True when the intent would change something, and so needs approval. */
  readonly mutating: boolean;
  /** Set when routing was ambiguous and Karl must disambiguate. */
  readonly needsClarification: string | null;
}

/** Intents that could change files or run commands. All require approval. */
const MUTATING: ReadonlySet<CodingIntentKind> = new Set<CodingIntentKind>([
  'fix_bug',
  'add_feature',
  'create_repository',
  'create_file', 'write_file', 'edit_file', 'delete_file',
  'run_tests',
]);

/**
 * Phrases that mean the user is discussing rather than commanding.
 * Keeps "what does push mean in git?" from becoming a push intent.
 */
const QUESTION_MARKERS = /\?\s*$/;

/**
 * A meta-question asks *about* a command, tool or concept. These must never
 * become actions.
 */
const META_QUESTION = /\b(what|why|how|when|where|which|who|does|is|are|can you)\b[^?]*\b(mean|means|do|does|is|are|works?|work|used for|happens|explain|difference between)\b/i;
const META_TOPICS = /\b(git|command|command line|cli|branch|commit|push|pull|merge|rebase|function|method|class|variable|typescript|javascript|python|npm|node)\b/i;

/** An explicit imperative that overrides the question heuristic. */
const CLEAR_COMMAND = /\b(fix|repair|resolve|run|execute|open|select|create|make|patch|investigate|debug|find|show me|cancel|stop|implement)\b/i;

function isMetaQuestion(text: string): boolean {
  return META_QUESTION.test(text) && META_TOPICS.test(text);
}

interface Rule {
  readonly kind: CodingIntentKind;
  readonly pattern: RegExp;
  readonly repository?: RegExp;
  readonly search?: RegExp;
}

const RULES: readonly Rule[] = [
  { kind: 'cancel_task', pattern: /\b(cancel|stop|abort|halt)\b.*\b(task|job|work)\b|\bcancel (the |current )?(task|everything)\b/i },
  // Checked before the question guard below, so "stop what you're doing" is
  // never mistaken for a question about the word "stop". The space is written
  // literally because `.` would need the /s flag to match a real space here.
  { kind: 'cancel_task', pattern: /\bstop (what you(?:'| a)re? doing|the current task|now)\b/i },
  { kind: 'cancel_task', pattern: /\b(abort|halt)\b\s+(?:the\s+)?(?:current\s+)?(task|work|everything|job)\b/i },
  { kind: 'show_changes', pattern: /\b(show|display|see)\b.*\b(what you changed|your changes|diff|changes)\b|\bgit diff\b|\bshow me the diff\b/i },
  { kind: 'list_repositories', pattern: /\b(list|show|what are)\b.*\b(repositor(y|ies)|projects)\b|\bmy repositor/i },
  { kind: 'run_tests', pattern: /\b(run|execute)\b.*\b(test|tests|test suite|npm test)\b/i },
  { kind: 'delete_file', pattern: /\b(delete|remove)\b.*(?:\bfile\b|\.[A-Za-z0-9]{1,8}\b)/i },
  { kind: 'edit_file', pattern: /\b(edit|update|change|replace)\b.*(?:\bfile\b|\.[A-Za-z0-9]{1,8}\b)/i },
  { kind: 'read_file', pattern: /\b(read|show|display)\b.*(?:\bfile\b|\.[A-Za-z0-9]{1,8}\b)/i },
  { kind: 'read_file', pattern: /\b(?:does|is)\b.*\bfile\b.*\b(?:exist|there|present)\b/i },
  { kind: 'create_file', pattern: /\b(create|make|add)\b.*(?:\bfile\b|\.[A-Za-z0-9]{1,8}\b)/i },
  { kind: 'write_file', pattern: /\b(write|save)\b.*(?:\bfile\b|\.[A-Za-z0-9]{1,8}\b)/i },
  { kind: 'create_repository', pattern: /\b(create|make|start|scaffold|set up|new)\b.*\b(repo(?:sitory|sitories)?|project|app|application|dashboard|service|site)\b/i },
  // "create a new repository called X" also matches, but only after the more
  // specific "called/named X" form below has had a chance to run.
  { kind: 'create_repository', pattern: /\b(?:create|make|scaffold|start)\b.*\brepositor(y|ies)\b/i },
  { kind: 'investigate_tests', pattern: /\b(investigate|why (is|are|do|does)|debug|diagnose|look into|examine)\b.*\b(test|tests|failing|failure|error)\b/i },
  { kind: 'investigate_tests', pattern: /\btest(s)? (are )?(failing|broken)\b/i },
  { kind: 'fix_bug', pattern: /\b(fix|repair|resolve|correct|solve|patch)\b/i },
  { kind: 'add_feature', pattern: /\b(add|implement|build|create)\b.*\b(feature|support for|endpoint|function|button|page|component|route)\b/i },
  { kind: 'find_code', pattern: /\b(find|locate|where is|search for|grep|look for)\b/i, search: /\b(?:where is|where|find|locate|search for|grep|look for)\b\s+(?:the\s+|a\s+|an\s+)?(.+?)(?:\s+(?:implemented|defined|used|handled|located)\b|[?.]|$)/i },
  { kind: 'explain_project', pattern: /\b(explain|describe|what is|whats|tell me about|summar(y|ise|ize))\b.*\b(this|the)? ?(project|repo|repository|codebase|code)\b/i },
  { kind: 'select_repository', pattern: /\b(open|select|switch to|go to)\s+(?:the\s+)?(?:my\s+)?([A-Za-z][A-Za-z0-9_.-]{1,40})\b/i, repository: /\b(?:open|select|switch to|go to)\s+(?:the\s+)?(?:my\s+)?([A-Za-z][A-Za-z0-9_.-]{1,40})\b/i },
  { kind: 'select_repository', pattern: /\bwork on\s+(?:the\s+)?(?:my\s+)?([A-Za-z][A-Za-z0-9_.-]{1,40})\b/i, repository: /\bwork on\s+(?:the\s+)?(?:my\s+)?([A-Za-z][A-Za-z0-9_.-]{1,40})\b/i },
  { kind: 'select_repository', pattern: /\b(?:open|select|switch to|work on)\s+(?:the\s+)?(?:my\s+|the\s+)?([A-Za-z0-9_.-]+)\s+(?:project|repo|repository)\b/i, repository: /\b(?:open|select|switch to|work on)\s+(?:the\s+)?(?:my\s+|the\s+)?([A-Za-z0-9_.-]+)\s+(?:project|repo|repository)\b/i },
];

/**
 * Generic nouns that follow "open"/"select" but never name a repository.
 * Without this, "open the project" resolves to a repository called "project".
 */
const GENERIC_NAMES = new Set([
  'project', 'projects', 'repo', 'repos', 'repository', 'repositories',
  'file', 'files', 'folder', 'directory', 'code', 'codebase',
  'app', 'application', 'service', 'site', 'page', 'thing', 'stuff',
  'one', 'it', 'this', 'that', 'test', 'tests', 'task', 'example', 'default',
]);

/**
 * Extract a plausible repository name from free text.
 *
 * Deliberately conservative: only a bare identifier, optionally with a known
 * repo suffix. This is a *hint* used to match against real discovered
 * repositories, never a path.
 */
export function extractRepositoryHint(text: string): string | null {
  const patterns = [
    /\b(?:open|select|switch to|work on|go to)\s+(?:the\s+)?(?:my\s+|the\s+)?([A-Za-z][A-Za-z0-9_.-]{1,40})\b/i,
    /\b([A-Za-z][A-Za-z0-9_.-]{1,40})\s+(?:project|repo|repository)\b/i,
    /\brepo(?:sitory)?\s+["'`]([A-Za-z][A-Za-z0-9_.-]{1,40})["'`]/i,
    // "fix the bug in BrightSpeakAPI", "investigate tests in DemoApp"
    /\b(?:fix|repair|investigate|debug|examine|review|open|check)\b[^,.]*?\bin\s+(?:the\s+)?([A-Za-z][A-Za-z0-9_.-]{1,40})\b/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (!match) continue;
    const candidate = match[1].replace(/[.,!?;:]+$/, '');
    if (!isPlausibleRepoName(candidate)) continue;
    return candidate;
  }
  return null;
}

/** Shared plausibility check for a spoken repository name. */
function isPlausibleRepoName(candidate: string): boolean {
  if (candidate.length < 2) return false;
  const lower = candidate.toLowerCase();
  if (STOP_WORDS.has(lower)) return false;
  if (GENERIC_NAMES.has(lower)) return false;
  return true;
}

/** Words that look like identifiers but are not repository names. */
const STOP_WORDS = new Set([
  'the', 'this', 'that', 'it', 'a', 'an', 'my', 'our', 'your', 'current', 'new',
  'test', 'tests', 'bug', 'issue', 'error', 'failing', 'feature', 'code', 'project',
  'repo', 'repository', 'app', 'application', 'dashboard', 'service', 'site', 'thing',
  'me', 'us', 'them', 'everything', 'anything', 'something', 'what', 'why', 'how',
  'please', 'can', 'could', 'would', 'should', 'will', 'you', 'i', 'we', 'and', 'or',
  'not', 'now', 'then', 'here', 'there', 'when', 'where', 'which', 'who', 'does',
  'do', 'did', 'is', 'are', 'was', 'were', 'has', 'have', 'had', 'be', 'been',
  'running', 'run', 'failing', 'fail', 'fails', 'broken', 'stuck', 'last', 'first',
]);


/** Words that make an extracted search term useless rather than specific. */
const PRONOUNS = new Set([
  'it', 'this', 'that', 'they', 'them', 'these', 'those', 'there', 'here',
  'something', 'anything', 'everything', 'one', 'stuff',
]);

export function sanitiseSearchTerm(raw: string): string | null {
  const trimmed = raw.trim().replace(/^["'`]|["'`]$/g, '').trim();
  if (!trimmed) return null;
  if (trimmed.length > 120) return null;
  // Reject control characters and path separators: a search term is not a path.
  if (/[\\/<>|]/.test(trimmed)) return null;
  // eslint-disable-next-line no-control-regex
  if (/[ -]/.test(trimmed)) return null;
  // "find where sum is" should search for "sum", not "sum is".
  const stripped = trimmed
    .replace(/^(?:where|is|are|the|a|an)\s+/i, '')
    .replace(/\s+(?:is|are|was|were)$/i, '')
    .trim();
  const term = stripped || trimmed;
  // A pronoun names nothing. Ask instead of searching for "it".
  if (PRONOUNS.has(term.toLowerCase())) return null;
  // Very short or purely punctuation terms would match everything.
  if (term.length < 3) return null;
  if (!/[A-Za-z0-9]/.test(term)) return null;
  return term;
}

/** Name a new repository should be created under, if one is stated. */
export function extractNewRepositoryName(text: string): string | null {
  const patterns = [
    /\b(?:called|named)\s+["'`]?([A-Za-z][A-Za-z0-9_.-]{1,40})["'`]?/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (!match) continue;
    const candidate = match[1].replace(/[.,!?;:]+$/, '');
    if (candidate.length < 2) continue;
    return candidate;
  }
  return null;
}

/** Only absolute Windows paths are accepted for direct file operations. */
export function extractAbsoluteFilePath(text: string): string | null {
  const quoted = /["'`]([A-Za-z]:[\\/][^"'`]+)["'`]/.exec(text)?.[1];
  const raw = quoted ?? /[A-Za-z]:[\\/][^\s"'`<>|?*]+/.exec(text)?.[0];
  return raw?.replace(/[.,!?;:]+$/, '') ?? null;
}

/** Technology keywords that inform a scaffold proposal (never an install). */
export function extractStackHints(text: string): readonly string[] {
  const hints: string[] = [];
  if (/\breact\b/i.test(text)) hints.push('React');
  if (/\btypescript\b|\bts\b/i.test(text)) hints.push('TypeScript');
  if (/\bjavascript\b|\bjs\b/i.test(text)) hints.push('JavaScript');
  if (/\bnode\b/i.test(text)) hints.push('Node.js');
  if (/\bvite\b/i.test(text)) hints.push('Vite');
  if (/\bnext\.?js\b/i.test(text)) hints.push('Next.js');
  if (/\bpython\b/i.test(text)) hints.push('Python');
  if (/\bdashboard\b/i.test(text)) hints.push('Dashboard');
  return hints;
}

/**
 * Classify a message. Deterministic and dependency-free so it can be tested
 * exhaustively and so behaviour never depends on model mood.
 */
export function routeCodingIntent(message: string): CodingIntent {
  const text = (message ?? '').trim();
  const base = (over: Partial<CodingIntent>): CodingIntent => ({
    kind: 'chitchat',
    repositoryName: null,
    searchTerm: null,
    interpretedAs: '',
    mutating: false,
    needsClarification: null,
    ...over,
  });

  if (!text) {
    return base({ needsClarification: 'Karl, what would you like Astra to do?' });
  }

  // A trailing question mark only suppresses an intent when the question is
  // *about* the coding domain rather than a request phrased as a question.
  // "what are my repositories?" is a listing request; "what does push mean?"
  // is not.
  if (QUESTION_MARKERS.test(text) && isMetaQuestion(text) && !CLEAR_COMMAND.test(text)) {
    return base({ interpretedAs: 'Treating this as a question about the concept rather than an instruction.' });
  }

  for (const rule of RULES) {
    if (!rule.pattern.test(text)) continue;
    const repositoryName = rule.repository ? (rule.repository.exec(text)?.[1] ?? null) : extractRepositoryHint(text);
    const searchTerm = rule.search ? sanitiseSearchTerm(rule.search.exec(text)?.[1] ?? '') : null;

    const intentRepository = repositoryName && isPlausibleRepoName(repositoryName) ? repositoryName : null;
    const intent = base({
      kind: rule.kind,
      // A rule may capture a name directly; it must pass the same plausibility
      // check as a loosely-extracted hint, or "open the file" would resolve to
      // a repository called "file".
      repositoryName: intentRepository,
      searchTerm,
      interpretedAs: describe(rule.kind, repositoryName, searchTerm),
      mutating: MUTATING.has(rule.kind),
      // "find where it is implemented" must ask, not search for the pronoun "it".
      needsClarification: needsClarificationFor(rule.kind, intentRepository, searchTerm),
    });
    return intent;
  }

  return base({ interpretedAs: 'No coding instruction recognised; treating this as conversation.' });
}

function describe(kind: CodingIntentKind, repository: string | null, term: string | null): string {
  const where = repository ? ` in ${repository}` : '';
  switch (kind) {
    case 'list_repositories': return 'List the repositories under the approved root.';
    case 'select_repository': return `Select repository${repository ? ` ${repository}` : ''}.`;
    case 'explain_project': return `Explain the project${where}.`;
    case 'find_code': return `Search for ${term ?? 'the term'} in the selected repository.`;
    case 'investigate_tests': return `Investigate failing tests${where} without changing anything.`;
    case 'fix_bug': return `Investigate and propose a fix${where}; changes need approval.`;
    case 'add_feature': return `Propose adding the requested feature${where}; changes need approval.`;
    case 'create_repository': return 'Propose creating a new repository inside the approved root.';
    case 'read_file': return 'Read the named file inside the approved root.';
    case 'create_file': return 'Propose creating the named file; approval is required.';
    case 'write_file': return 'Propose writing the named file; approval is required.';
    case 'edit_file': return 'Propose replacing the named file with reviewed content; approval is required.';
    case 'delete_file': return 'Propose deleting the named file; approval is required.';
    case 'run_tests': return 'Run the approved test command.';
    case 'show_changes': return 'Show the current Git diff for the selected repository.';
    case 'cancel_task': return 'Cancel the current coding task and stop further tool actions.';
    default: return '';
  }
}

function needsClarificationFor(kind: CodingIntentKind, repository: string | null, term: string | null): string | null {
  switch (kind) {
    case 'select_repository':
      return repository ? null : 'Which repository should Astra open? It must be under the approved root.';
    case 'find_code':
      return term ? null : 'What exactly should Astra search for?';
    case 'create_repository':
      return null;
    default:
      return null;
  }
}

/** True when this intent needs a selected repository to act on. */
export function requiresRepository(intent: CodingIntent): boolean {
  return ['select_repository', 'explain_project', 'find_code', 'investigate_tests', 'fix_bug', 'add_feature', 'run_tests', 'show_changes'].includes(intent.kind);
}
