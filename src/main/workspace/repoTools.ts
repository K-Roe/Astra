import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import {
  isIndexableFile,
  isIgnoredDirectory,
  isSensitiveFile,
  resolveWithinRoot,
  type SandboxOptions,
} from './pathGuard';

/**
 * Read-only repository inspection.
 *
 * Discovery never executes anything: it looks for `.git` directories and
 * reads metadata files. Nothing here writes, and secrets are filtered out
 * before any file content can reach a model context or the knowledge store.
 */

export interface DiscoveredRepo {
  readonly name: string;
  readonly root: string;
  readonly hasGit: boolean;
  readonly detectedLanguages: readonly string[];
  readonly description: string;
}

export interface ProjectFile {
  readonly absolutePath: string;
  readonly relativePath: string;
  readonly bytes: number;
}

/** Extensions mapped to a human language name, used for the Projects view. */
const LANGUAGE_BY_EXTENSION: Readonly<Record<string, string>> = {
  '.ts': 'TypeScript', '.tsx': 'TypeScript', '.mts': 'TypeScript', '.cts': 'TypeScript',
  '.js': 'JavaScript', '.jsx': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript',
  '.py': 'Python', '.go': 'Go', '.rs': 'Rust', '.java': 'Java', '.cs': 'C#',
  '.rb': 'Ruby', '.php': 'PHP', '.swift': 'Swift', '.kt': 'Kotlin',
  '.c': 'C', '.h': 'C', '.cpp': 'C++', '.hpp': 'C++', '.cshtml': 'Razor',
  '.sh': 'Shell', '.ps1': 'PowerShell', '.sql': 'SQL', '.json': 'JSON', '.md': 'Markdown',
};

const FRAMEWORK_MARKERS: readonly { readonly file: string; readonly name: string }[] = [
  { file: 'package.json', name: 'Node' },
  { file: 'tsconfig.json', name: 'TypeScript' },
  { file: 'vite.config.ts', name: 'Vite' },
  { file: 'vite.config.js', name: 'Vite' },
  { file: 'Cargo.toml', name: 'Rust' },
  { file: 'go.mod', name: 'Go' },
  { file: 'requirements.txt', name: 'Python' },
  { file: 'pyproject.toml', name: 'Python' },
  { file: 'pom.xml', name: 'Java/Maven' },
  { file: 'CMakeLists.txt', name: 'CMake' },
];

/** Test commands inferred from project metadata. Never executed here. */
const TEST_COMMAND_HINTS: Readonly<Record<string, readonly string[]>> = {
  'package.json': ['npm test'],
  'pyproject.toml': ['python -m pytest'],
  'requirements.txt': ['python -m pytest'],
  'Cargo.toml': ['cargo test'],
  'go.mod': ['go test ./...'],
  'pom.xml': ['mvn test'],
  'CMakeLists.txt': ['ctest'],
};

/**
 * Find Git repositories under the approved root, one level of nesting by
 * default so discovery stays fast and cannot wander into dependency trees.
 */
export function discoverRepositories(sandbox: SandboxOptions, maxDepth = 2, limit = 100): DiscoveredRepo[] {
  const root = resolveWithinRoot(sandbox.root, { ...sandbox, allowLinks: true });
  const found: DiscoveredRepo[] = [];

  const walk = (directory: string, depth: number): void => {
    if (found.length >= limit || depth > maxDepth) return;
    let entries: string[];
    try {
      entries = readdirSync(directory);
    } catch {
      return;
    }
    if (depth > 0 && (entries.some((entry) => ['package.json', 'composer.json', 'artisan', 'pyproject.toml', 'Cargo.toml', 'go.mod'].includes(entry)) || entries.includes('.git'))) {
      found.push(describeRepository(directory, sandbox));
      return; // Do not descend into a repository's own working tree.
    }
    for (const entry of entries) {
      if (isIgnoredDirectory(entry) || entry.startsWith('.')) continue;
      let stats;
      try {
        stats = statSync(path.join(directory, entry));
      } catch {
        continue;
      }
      if (stats.isDirectory()) walk(path.join(directory, entry), depth + 1);
    }
  };

  walk(root, 0);
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

export function describeRepository(root: string, sandbox: SandboxOptions): DiscoveredRepo {
  const safeRoot = resolveWithinRoot(root, sandbox);
  const languages = new Set<string>();
  const frameworks = new Set<string>();
  let description = '';

  // Languages come from the whole tree (capped), not just the top level, so a
  // TypeScript project in `src/` is not reported as having no languages.
  for (const file of listProjectFiles(safeRoot, { root: safeRoot, allowLinks: sandbox.allowLinks }, { maxEntries: 600, maxDepth: 3 })) {
    const language = LANGUAGE_BY_EXTENSION[path.extname(file.relativePath).toLowerCase()];
    if (language) languages.add(language);
  }

  try {
    for (const entry of readdirSync(safeRoot, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const marker = FRAMEWORK_MARKERS.find((m) => m.file === entry.name);
      if (marker) frameworks.add(marker.name);
      if (entry.name === 'package.json') description = readPackageDescription(safeRoot);
      if (entry.name === 'README.md') description = description || readReadmeSummary(safeRoot);
    }
  } catch {
    // An unreadable directory yields a minimal, honest record.
  }

  return {
    name: path.basename(safeRoot),
    root: safeRoot,
    hasGit: existsSync(path.join(safeRoot, '.git')),
    detectedLanguages: [...languages].sort(),
    description,
  };
}

function readPackageDescription(root: string): string {
  try {
    const parsed = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { description?: string; name?: string };
    if (typeof parsed.description === 'string') return parsed.description.slice(0, 300);
    return typeof parsed.name === 'string' ? `${parsed.name}` : '';
  } catch {
    return '';
  }
}

function readReadmeSummary(root: string): string {
  try {
    const text = readFileSync(path.join(root, 'README.md'), 'utf8');
    const line = text.split(/\r?\n/).map((l) => l.replace(/^#+\s*/, '').trim()).find((l) => l.length > 0);
    return (line ?? '').slice(0, 300);
  } catch {
    return '';
  }
}

/** Test commands suggested by the project's own metadata. */
export function suggestTestCommands(root: string, sandbox: SandboxOptions): string[] {
  const safeRoot = resolveWithinRoot(root, sandbox);
  const commands: string[] = [];
  for (const [file, hints] of Object.entries(TEST_COMMAND_HINTS)) {
    if (!existsSync(path.join(safeRoot, file))) continue;
    commands.push(...hints);
  }
  return [...new Set(commands)];
}

/** List files under a repository, honouring ignore rules and refusing secrets. */
export function listProjectFiles(root: string, sandbox: SandboxOptions, options: { maxEntries?: number; maxDepth?: number } = {}): ProjectFile[] {
  const safeRoot = resolveWithinRoot(root, sandbox);
  const maxEntries = options.maxEntries ?? 2000;
  const maxDepth = options.maxDepth ?? 6;
  const results: ProjectFile[] = [];

  const walk = (directory: string, depth: number): void => {
    if (results.length >= maxEntries || depth > maxDepth) return;
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (results.length >= maxEntries) return;
      if (entry.isDirectory()) {
        if (isIgnoredDirectory(entry.name) || entry.name === '.git') continue;
        walk(path.join(directory, entry.name), depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!isIndexableFile(entry.name)) continue;
      const absolutePath = path.join(directory, entry.name);
      let bytes: number;
      try {
        bytes = statSync(absolutePath).size;
      } catch {
        continue;
      }
      results.push({ absolutePath, relativePath: path.relative(safeRoot, absolutePath), bytes });
    }
  };

  walk(safeRoot, 0);
  return results.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

export interface ReadFileResult {
  readonly text: string;
  readonly bytes: number;
  readonly truncated: boolean;
  readonly relativePath: string;
}

/** Read a text file inside the sandbox, refusing secrets and oversized files. */
export function readProjectFile(
  absolutePath: string,
  sandbox: SandboxOptions,
  options: { maxBytes?: number } = {},
): ReadFileResult {
  const safePath = resolveWithinRoot(absolutePath, sandbox);
  if (isSensitiveFile(safePath)) {
    throw new Error('refusing to read a credential or secret file');
  }
  const stats = statSync(safePath);
  if (!stats.isFile()) throw new Error('not a file');
  const maxBytes = options.maxBytes ?? 512_000;
  if (stats.size > maxBytes) {
    return { text: readFileSync(safePath, 'utf8').slice(0, maxBytes), bytes: stats.size, truncated: true, relativePath: path.relative(solveRoot(sandbox), safePath) };
  }
  return { text: readFileSync(safePath, 'utf8'), bytes: stats.size, truncated: false, relativePath: path.relative(solveRoot(sandbox), safePath) };
}

function solveRoot(sandbox: SandboxOptions): string {
  return resolveWithinRoot(sandbox.root, { ...sandbox, allowLinks: true });
}

/** Simple substring/code search across indexable files. */
export function searchProjectCode(
  root: string,
  sandbox: SandboxOptions,
  needle: string,
  options: { maxMatches?: number; caseSensitive?: boolean } = {},
): { readonly relativePath: string; readonly line: number; readonly text: string }[] {
  const maxMatches = options.maxMatches ?? 100;
  const results: { relativePath: string; line: number; text: string }[] = [];
  if (!needle) return results;
  const haystack = options.caseSensitive ? needle : needle.toLowerCase();

  for (const file of listProjectFiles(root, sandbox, { maxEntries: 1500 })) {
    if (results.length >= maxMatches) break;
    let content: string;
    try {
      content = readFileSync(file.absolutePath, 'utf8');
    } catch {
      continue;
    }
    if (content.includes('\u0000')) continue; // binary
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const candidate = options.caseSensitive ? lines[i] : lines[i].toLowerCase();
      if (!candidate.includes(haystack)) continue;
      results.push({ relativePath: file.relativePath, line: i + 1, text: lines[i].slice(0, 300) });
      if (results.length >= maxMatches) break;
    }
  }
  return results;
}

export function describeProject(root: string, sandbox: SandboxOptions): DiscoveredRepo & {
  readonly frameworks: readonly string[];
  readonly testCommands: readonly string[];
  readonly fileCount: number;
} {
  const base = describeRepository(root, sandbox);
  const safeRoot = resolveWithinRoot(root, sandbox);
  const frameworks: string[] = [];
  try {
    for (const entry of readdirSync(safeRoot, { withFileTypes: true })) {
      const marker = FRAMEWORK_MARKERS.find((m) => m.file === entry.name);
      if (marker) frameworks.push(marker.name);
    }
  } catch {
    // reported as an empty framework list
  }
  return {
    ...base,
    frameworks,
    testCommands: suggestTestCommands(safeRoot, sandbox),
    fileCount: listProjectFiles(safeRoot, sandbox, { maxEntries: 1000 }).length,
  };
}
