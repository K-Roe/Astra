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
  | 'create_directory'
  | 'delete_directory'
  | 'run_tests'
  | 'show_changes'
  | 'check_path'
  | 'check_repository'
  | 'check_service'
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
  /** Absolute path the request names, for the verification intents. */
  readonly path: string | null;
  /** Loopback address the request names, for the service intent. */
  readonly serviceUrl: string | null;
}

/** Intents that could change files or run commands. All require approval. */
const MUTATING: ReadonlySet<CodingIntentKind> = new Set<CodingIntentKind>([
  'fix_bug',
  'add_feature',
  'create_repository',
  'create_file', 'write_file', 'edit_file', 'delete_file',
  'create_directory', 'delete_directory',
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
  /**
   * Skip this rule when the message also matches the blocker.
   *
   * Used where a broad noun would otherwise steal a message that is really
   * about something else: "create a folder inside my repositories" is a
   * creation request, not a request to list them.
   */
  readonly blockedBy?: RegExp;
}

/** Words that make a request about creating something. */
const CREATION_FRAME = /\b(create|creating|make|making|made|scaffold|set up|setup|start|started|new|add|build|generate|initialise|initialize|bootstrap|scaffold)\b/i;

/** Any loopback address or a bare `localhost`, with or without a port. */
const LOOPBACK_ADDRESS = /\b(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(?::\d{1,5})?\b/i;

/** A `http(s)://` URL of any host, used to keep URL traffic out of repo routing. */
const ANY_URL = /\bhttps?:\/\//i;

/** Any address or host that belongs to a service check rather than a repository. */
const SERVICE_ADDRESS = new RegExp(String.raw`${ANY_URL.source}|${LOOPBACK_ADDRESS.source}`, 'i');

/** An absolute Windows path as Karl would read it aloud or paste it. */
const WINDOWS_PATH = /\b[A-Za-z]:[\\/]/;

/** Nouns that mean a directory, a project or a local service. */
const PROJECT_NOUNS = 'repo(?:sitory|sitories)?|project|app|application|dashboard|service|site|website|blog|folder|directory|codebase|package';

/**
 * A claim about the existence or location of one of those nouns.
 *
 * Built from `PROJECT_NOUNS` so the two cannot drift apart.
 */
const PROJECT_EXISTENCE_CLAIM = new RegExp(
  String.raw`\b(?:does|do|is|are|has|have|where|which|what)\b[^?]*\b(?:${PROJECT_NOUNS})\b`,
  'i',
);

/**
 * A request explicitly about a single file.
 *
 * CA-01B gives files their own read/create/write/edit/delete tools with exact
 * paths and byte verification. Existence questions about a *file* keep using
 * them; `check_path` is for directories, projects and repositories.
 */
const FILE_SUBJECT = /\bfile\b|\b[A-Za-z0-9_.-]+\.[A-Za-z0-9]{1,8}\b/i;

/**
 * A standalone directory noun.
 *
 * The lookarounds stop it matching inside a hyphenated path component, so
 * `C:\repos\plain-folder\AstraBackstory.js` remains a *file* request.
 */
const DIRECTORY_NOUN = '(?<![\\w-])(?:folder|directory|dir)(?![\\w-])';

const RULES: readonly Rule[] = [
  { kind: 'cancel_task', pattern: /\b(cancel|stop|abort|halt)\b.*\b(task|job|work)\b|\bcancel (the |current )?(task|everything)\b/i },
  // Checked before the question guard below, so "stop what you're doing" is
  // never mistaken for a question about the word "stop". The space is written
  // literally because `.` would need the /s flag to match a real space here.
  { kind: 'cancel_task', pattern: /\bstop (what you(?:'| a)re? doing|the current task|now)\b/i },
  { kind: 'cancel_task', pattern: /\b(abort|halt)\b\s+(?:the\s+)?(?:current\s+)?(task|work|everything|job)\b/i },
  { kind: 'show_changes', pattern: /\b(show|display|see)\b.*\b(what you changed|your changes|diff|changes)\b|\bgit diff\b|\bshow me the diff\b/i },

  // ---- Verification intents. These come first on purpose: a question about
  // whether something exists, is a repository, or is running must be answered
  // from a real check, never from the language model's imagination.
  {
    kind: 'check_service',
    pattern: /\b(?:is|are|does|do|can|could|has|have|still|anything)\b[^?]*\b(?:running|listening|available|reachable|responding|live|up and running|serving|hosted)\b/i,
    blockedBy: CREATION_FRAME,
  },
  {
    kind: 'check_repository',
    pattern: /\b(?:is|are|does|do|can|could|has|have)\b[^?]*\b(?:a\s+|an\s+|the\s+)?(?:git|version(?:[\s-]controlled)?)\b[^?]*\b(?:repo(?:sitory)?|controlled|tracked|initiali[sz]ed|initialised|initialized)\b/i,
    blockedBy: CREATION_FRAME,
  },
  {
    kind: 'check_repository',
    pattern: /\b(?:git|version control|vc)\b[^?]*\b(?:repo|repository|folder|directory|project)\b/i,
    blockedBy: CREATION_FRAME,
  },
  {
    kind: 'check_path',
    pattern: /\b(?:does|do|is|are|was|were)\b[^?]*\b(?:exist|still exist|still there|still present|actually exist)\b/i,
    blockedBy: FILE_SUBJECT,
  },
  {
    kind: 'check_path',
    pattern: /\bwhere\s+(?:is|are|does|do)\b[^?]*\b(?:locat\w*|sit|lives?|exist|kept|stored)\b/i,
    blockedBy: FILE_SUBJECT,
  },
  {
    kind: 'check_path',
    pattern: /\b(?:check|verify|confirm|look)\b[^?]*\b(?:exist|folder|directory|project|repo(?:sitory)?|path)\b/i,
    blockedBy: FILE_SUBJECT,
  },

  // ---- Existing actions. A message that creates something must never be
  // demoted to a read-only listing just because it says "my repositories".
  { kind: 'list_repositories', pattern: /\b(list|show|what are)\b.*\b(repositor(y|ies)|projects)\b|\bmy repositor/i, blockedBy: CREATION_FRAME },
  { kind: 'run_tests', pattern: /\b(run|execute)\b.*\b(test|tests|test suite|npm test)\b/i },
  // Directories have their own actions. These must be matched before the file
  // and repository rules: "create a folder called X" is a plain directory, not a
  // scaffolded project and not a file.
  //
  // The lookarounds stop the noun matching inside a hyphenated path component,
  // so `C:\repos\plain-folder\AstraBackstory.js` stays a *file* request.
  { kind: 'delete_directory', pattern: new RegExp(String.raw`\b(?:delete|remove|get rid of|clear out)\b.*\b${DIRECTORY_NOUN}\b`, 'i') },
  { kind: 'create_directory', pattern: new RegExp(String.raw`\b(?:create|make|add|new|mkdir)\b.*\b${DIRECTORY_NOUN}\b`, 'i') },
  { kind: 'delete_file', pattern: /\b(delete|remove)\b.*(?:\bfile\b|\.[A-Za-z0-9]{1,8}\b)/i },
  { kind: 'edit_file', pattern: /\b(edit|update|change|replace)\b.*(?:\bfile\b|\bcontents?\b|\bfunction\b|\.[A-Za-z0-9]{1,8}\b)/i },
  { kind: 'read_file', pattern: /\b(read|show|display)\b.*(?:\bfile\b|\.[A-Za-z0-9]{1,8}\b)/i },
  { kind: 'read_file', pattern: /\b(?:does|is)\b.*\bfile\b.*\b(?:exist|there|present)\b/i },
  { kind: 'create_file', pattern: /\b(create|make|add)\b.*(?:\bfile\b|\bcomponent\b|\bcontroller\b|\bREADME\b|\.[A-Za-z0-9]{1,8}\b)/i },
  { kind: 'write_file', pattern: /\b(write|save)\b.*(?:\bfile\b|\bREADME\b|\.[A-Za-z0-9]{1,8}\b)/i },
  // A request to make something must be recognised however Karl names it. The
  // earlier defect: the noun list stopped at "site", so "create a blog called
  // X" matched no rule at all, became chitchat, and was handed to the chat
  // model — which invented the repository, its path and its URL.
  //
  // `folder` and `directory` are deliberately absent: they are handled by the
  // directory actions above. Listing them here used to send "create a folder"
  // into the project scaffolder, which proposes a whole repository for what
  // should have been a single empty directory.
  { kind: 'create_repository', pattern: /\b(create|make|start|scaffold|set up|new|generate|bootstrap|initialise|initialize)\b.*\b(repo(?:sitory|sitories)?|project|app|application|dashboard|service|site|website|blog)\b/i },
  { kind: 'create_repository', pattern: /\bi\s+(?:want|need|would like|am looking for)\b.*\b(?:repo(?:sitory|sitories)?|project|app|application|dashboard|service|site|website|blog|folder|directory)\b/i },
  // "create a new repository called X" also matches, but only after the more
  // specific "called/named X" form below has had a chance to run.
  { kind: 'create_repository', pattern: /\b(?:create|make|scaffold|start)\b.*\brepositor(y|ies)\b/i },
  { kind: 'investigate_tests', pattern: /\b(investigate|why (is|are|do|does)|debug|diagnose|look into|examine)\b.*\b(test|tests|failing|failure|error)\b/i },
  { kind: 'investigate_tests', pattern: /\btest(s)? (are )?(failing|broken)\b/i },
  { kind: 'fix_bug', pattern: /\b(fix|repair|resolve|correct|solve|patch)\b/i },
  { kind: 'add_feature', pattern: /\b(add|implement|build|create)\b.*\b(feature|support for|endpoint|function|button|page|component|route)\b/i },
  { kind: 'find_code', pattern: /\b(find|locate|where is|search for|grep|look for)\b/i, search: /\b(?:where is|where|find|locate|search for|grep|look for)\b\s+(?:the\s+|a\s+|an\s+)?(.+?)(?:\s+(?:implemented|defined|used|handled|located)\b|[?.]|$)/i },
  { kind: 'explain_project', pattern: /\b(explain|describe|what is|whats|tell me about|summar(y|ise|ize))\b.*\b(this|the)? ?(project|repo|repository|codebase|code)\b/i },
  // A URL or port belongs to the service check, never to a repository named
  // "website". Blocking here is what stops "open the website at localhost:3000"
  // from being resolved as a repository called "website".
  { kind: 'select_repository', pattern: /\b(open|select|switch to|go to)\s+(?:the\s+)?(?:my\s+)?([A-Za-z][A-Za-z0-9_.-]{1,40})\b/i, repository: /\b(?:open|select|switch to|go to)\s+(?:the\s+)?(?:my\s+)?([A-Za-z][A-Za-z0-9_.-]{1,40})\b/i, blockedBy: SERVICE_ADDRESS },
  { kind: 'select_repository', pattern: /\bwork on\s+(?:the\s+)?(?:my\s+)?([A-Za-z][A-Za-z0-9_.-]{1,40})\b/i, repository: /\bwork on\s+(?:the\s+)?(?:my\s+)?([A-Za-z][A-Za-z0-9_.-]{1,40})\b/i },
  { kind: 'select_repository', pattern: /\b(?:open|select|switch to|work on)\s+(?:the\s+)?(?:my\s+|the\s+)?([A-Za-z0-9_.-]+)\s+(?:project|repo|repository)\b/i, repository: /\b(?:open|select|switch to|work on)\s+(?:the\s+)?(?:my\s+|the\s+)?([A-Za-z0-9_.-]+)\s+(?:project|repo|repository)\b/i },
];

/**
 * Generic nouns that follow "open"/"select" but never name a repository.
 * Without this, "open the project" resolves to a repository called "project".
 */
const GENERIC_NAMES = new Set([
  'project', 'projects', 'repo', 'repos', 'repository', 'repositories',
  'file', 'files', 'folder', 'folders', 'directory', 'directories', 'code', 'codebase',
  'app', 'application', 'service', 'site', 'website', 'webpage', 'blog', 'server',
  'page', 'thing', 'stuff', 'one', 'it', 'this', 'that', 'test', 'tests', 'task',
  'example', 'default', 'localhost', 'url',
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

/**
 * Words that end the spoken name, because a new clause has started.
 *
 * Without these the capture runs to the end of the sentence, so "called
 * Astra's Blog and build me a website" proposes a project called
 * `AstrasBlogAndBuildMeAWebsite` — a different project from the one Karl named.
 */
const NAME_CLAUSE_END = 'inside|within|under|into|onto|with|using|that|which|and|then|plus|also|so|because|but|where|when|for|in|at|on|via|from';

/**
 * Name a new repository or directory should be created under, if one is stated.
 *
 * The capture runs to a clause boundary rather than stopping at the first
 * punctuation: an apostrophe is part of the name, not the end of it. Truncating
 * "Astra's Blog" to "Astra" would silently drop half of what Karl asked for and
 * propose a different project than the one he named.
 */
export function extractNewRepositoryName(text: string): string | null {
  const match = new RegExp(String.raw`\b(?:called|named)\s+([^"\`\n]{2,48}?)(?=\s+(?:${NAME_CLAUSE_END})\b|[?.!]|$)`, 'i').exec(text);
  if (!match) return null;
  const candidate = match[1].replace(/^["'`]+|["'`]+$/g, '').trim();
  return candidate.length >= 2 ? candidate : null;
}

/**
 * Articles that must not become part of a directory name.
 *
 * Deliberately minimal: only true determiners are dropped. Keeping "my" and
 * "new" means "My Blog" folds to `MyBlog` rather than losing half the name,
 * which is what Karl asked for when he said names should join up.
 */
const NAME_NOISE = new Set(['a', 'an', 'the']);

/** Windows reserved device names, refused whatever the case. */
const RESERVED_DEVICE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/**
 * Fold a spoken or written name into one safe directory name.
 *
 * Karl asked that names be *joined up* rather than loosened: "Astra's Blog"
 * becomes `AstrasBlog`, "my blog" becomes `MyBlog`. An apostrophe joins instead
 * of separating, so "Astra's" yields "Astras" rather than a stray "S".
 *
 * This deliberately keeps the existing safety posture instead of widening it:
 * the result still contains only letters and digits, still starts with a
 * letter, is still length-bounded, and is still refused if it would collide
 * with a Windows device name. No separator, traversal or reserved name can
 * survive, because none of them can appear in the output.
 */
export function normaliseDirectoryName(raw: string): string | null {
  const parts = raw
    // Apostrophes join rather than split: "Astra's" must not become "Astra S".
    .replace(/['’‘`]/g, '')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .filter((part) => !NAME_NOISE.has(part.toLowerCase()))
    .map((part) => part[0].toUpperCase() + part.slice(1));
  const name = parts.join('');
  if (name.length < 2 || name.length > 40) return null;
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(name)) return null;
  if (RESERVED_DEVICE.test(name)) return null;
  return name;
}

/** The name after normalisation, and whether normalisation changed it. */
export function normalisedName(raw: string): { name: string; changed: boolean } | null {
  const name = normaliseDirectoryName(raw);
  if (!name) return null;
  return { name, changed: name.toLowerCase() !== raw.trim().toLowerCase() };
}

/**
 * Words that never end a path, in any phrasing.
 *
 * These are function words and interrogative verbs, so trimming them can only
 * remove speech that followed the path.
 */
const PATH_FUNCTION_WORDS = 'exist|exists|existed|there|still|now|yet|the|a|an|is|are|was|were|of|in|at|on|to';

/**
 * Nouns that end a path only when the sentence is a question about it.
 *
 * `Is C:\tmp\BlogRepo a git repository?` puts three words after the path. In an
 * imperative (`Create file C:\tmp\a.ts`) the same words would be part of a
 * legitimate directory name, so this trimming is only applied when the caller
 * has already determined the message is interrogative.
 *
 * Trimming too much fails safely: the tool then reports "not found" *and prints
 * the exact path it checked*, rather than asserting something about a path
 * nobody verified. Trimming too little — the original behaviour — produced a
 * confidently wrong path, which is how `Astra's Blog` became `Astra`.
 */
const PATH_QUESTION_WORDS = 'repository|repo|repositories|folder|directory|project|website|site|blog|application|app|controlled|version|git|located|sit|sits|lives|stored|kept|inside|under|about|one|this|that|it|here';

/**
 * Words that mean more speech follows.
 *
 * `C:\repos\Astra's Blog exist?` ends with "Blog exist". Trimming "Blog" would
 * report on `…Astra's`, which is a real path that does not exist — a confident
 * wrong answer. The presence of a verb or existential after a noun means the
 * noun was part of the path, so the run is left alone.
 */
const PATH_SPEECH_MARKERS = 'exist|exists|existed|is|are|was|were|there|still|now|yet';

function trimPathTail(raw: string, extraWords: string): string {
  const run = /((?:\s+\S+)+)$/.exec(raw)?.[1];
  if (!run) return raw;
  const tokens = run.trim().split(/\s+/);
  const trimmable = new RegExp(String.raw`^(?:${extraWords ? `${extraWords}|` : ''}${PATH_FUNCTION_WORDS})$`, 'i');
  const speech = new RegExp(String.raw`^(?:${PATH_SPEECH_MARKERS})$`, 'i');

  const dropped: string[] = [];
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    const token = tokens[index];
    if (!trimmable.test(token)) break;
    // A noun belongs to the path when speech continues after it: in
    // `C:\repos\Astra's Blog exist?`, "Blog" is followed by "exist".
    if (!speech.test(token) && dropped.some((later) => speech.test(later))) break;
    dropped.unshift(token);
  }
  if (dropped.length === 0) return raw;
  // Each dropped token was preceded by one separator character.
  return raw.slice(0, raw.length - dropped.reduce((total, token) => total + token.length + 1, 0));
}

/**
 * How much text after a drive letter belongs to the path.
 *
 * - `strict`   — stop at the first space. Used for file operations, where the
 *                message is `verb file <path> [prose]` and trailing prose must
 *                not be swallowed.
 * - `sentence` — run to a sentence boundary, trimming only function words.
 *                Used for directories, whose names may contain a space and
 *                which are normalised before use.
 * - `question` — as above plus the trailing question phrase. Used by the
 *                verification intents, so `… Astra's Blog exist?` resolves to
 *                the directory Karl actually named.
 */
export type PathReadMode = 'strict' | 'sentence' | 'question';

/**
 * Only absolute Windows paths are accepted for direct file operations.
 *
 * An apostrophe is legal in a Windows name and is kept, but an imperative is
 * still read as `verb file <path>` so that trailing prose ("with this content")
 * cannot be swallowed into the path. Only the verification intents, whose
 * messages are questions by construction, read past the first space — otherwise
 * `C:\repos\Astra's Blog exist?` would truncate to `C:\repos\Astra`, a real path
 * that does not exist and therefore a confident wrong answer.
 */
export function extractAbsoluteFilePath(text: string, mode: PathReadMode = 'strict'): string | null {
  const quoted = /["'`]([A-Za-z]:[\\/][^"'`]+)["'`]/.exec(text)?.[1];
  if (quoted) return quoted.replace(/[.,!?;:]+$/, '') || null;

  const start = /[A-Za-z]:[\\/]/.exec(text)?.index;
  if (start === undefined) return null;

  if (mode === 'strict') {
    return /[A-Za-z]:[\\/][^\s"`<>|?*]+/.exec(text.slice(start))?.[0].replace(/[.,!?;:]+$/, '') || null;
  }

  // A period only ends the path when it is not a file extension.
  const boundary = /[.!?](?=\s|$)/.exec(text.slice(start));
  const raw = (boundary ? text.slice(start, start + boundary.index) : text.slice(start)).replace(/[,;:]+$/, '');
  return trimPathTail(raw, mode === 'question' ? PATH_QUESTION_WORDS : '') || null;
}

/**
 * The loopback address Karl named, if any.
 *
 * Only loopback is recognised, because that is the only address Astra is
 * allowed to probe. A public hostname is deliberately not recognised here, so
 * it cannot become a service claim that Astra never checked.
 */
export function extractLoopbackAddress(text: string): string | null {
  const match = /\b((?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?)\b/i.exec(text)?.[1];
  if (!match) return null;
  return match.toLowerCase().startsWith('http') ? match : `http://${match}`;
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
    path: null,
    serviceUrl: null,
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
    return verificationFallback(text, base) ?? base({ interpretedAs: 'Treating this as a question about the concept rather than an instruction.' });
  }

  for (const rule of RULES) {
    if (!rule.pattern.test(text)) continue;
    // A blocked rule must not silently win: if blocking removed this rule, try
    // the next one rather than treating the message as ordinary conversation.
    if (rule.blockedBy?.test(text)) continue;
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
      ...verificationEntities(rule.kind, text),
    });
    return intent;
  }

  // The safety net. This is the structural fix for the defect that produced
  // "the repository is now located at C:\...\Astra's Blog": the rule table could
  // always be out-completed by a phrasing nobody had enumerated, and the
  // fallback was the chat model. Anything that names a loopback service, a
  // filesystem path or a project's existence must reach a real check instead,
  // no matter how it was phrased.
  const fallback = verificationFallback(text, base);
  if (fallback) return fallback;

  return base({ interpretedAs: 'No coding instruction recognised; treating this as conversation.' });
}

/**
 * Route a message that names a service, a path or a project's existence to a
 * verification tool, whatever the phrasing. Returns null when the message is
 * genuinely conversational.
 *
 * This deliberately is not a refusal: each branch produces a real filesystem or
 * socket check whose result becomes the reply.
 */
function verificationFallback(text: string, base: (over: Partial<CodingIntent>) => CodingIntent): CodingIntent | null {
  if (LOOPBACK_ADDRESS.test(text) || /\b(?:dev|development|preview|web)\s+server\b/i.test(text) || /\bport\s+\d{2,5}\b/i.test(text)) {
    const serviceUrl = extractLoopbackAddress(text) ?? (LOOPBACK_ADDRESS.test(text) ? 'http://localhost' : null);
    return base({
      kind: 'check_service',
      serviceUrl,
      interpretedAs: 'Check whether a local service is really listening, instead of assuming it is.',
      ...verificationEntities('check_service', text),
    });
  }

  if (WINDOWS_PATH.test(text)) {
    return base({
      kind: 'check_path',
      interpretedAs: 'Inspect the named path on disk, instead of assuming it exists.',
      ...verificationEntities('check_path', text),
    });
  }

  // "a repository", "a project", "a folder" as the subject of a claim still
  // needs a real answer even when no path was typed.
  if (PROJECT_EXISTENCE_CLAIM.test(text)) {
    return base({
      kind: 'check_path',
      interpretedAs: 'Inspect the named project or directory on disk, instead of assuming it exists.',
      ...verificationEntities('check_path', text),
    });
  }

  return null;
}

/** Pull the address or path out of the message for the verification intents. */
function verificationEntities(kind: CodingIntentKind, text: string): Partial<CodingIntent> {
  if (kind === 'check_service') {
    return { serviceUrl: extractLoopbackAddress(text) ?? (LOOPBACK_ADDRESS.test(text) ? 'http://localhost' : null) };
  }
  if (kind === 'check_path' || kind === 'check_repository') {
    // These intents only exist for questions, so a trailing question phrase
    // may be trimmed from the path.
    return { path: extractAbsoluteFilePath(text, 'question') };
  }
  return {};
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
    case 'create_directory': return 'Propose creating the named directory; approval is required.';
    case 'delete_directory': return 'Propose deleting the named directory and everything inside it; approval is required.';
    case 'run_tests': return 'Run the approved test command.';
    case 'show_changes': return 'Show the current Git diff for the selected repository.';
    case 'check_path': return 'Inspect the named path on disk and report only what the filesystem shows.';
    case 'check_repository': return 'Check for real Git metadata and report only what is present.';
    case 'check_service': return 'Probe the local address and report whether a connection was actually accepted.';
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
