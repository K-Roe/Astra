import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  routeCodingIntent, extractRepositoryHint, extractNewRepositoryName,
  extractStackHints, sanitiseSearchTerm, requiresRepository,
} = require('../dist-electron/main/agent/codingIntent.js');

test('repository listing is recognised', () => {
  assert.equal(routeCodingIntent('Show me my repositories').kind, 'list_repositories');
  assert.equal(routeCodingIntent('list projects').kind, 'list_repositories');
  assert.equal(routeCodingIntent('what are my repositories?').kind, 'list_repositories');
});

test('opening a repository is recognised and names it', () => {
  const intent = routeCodingIntent('Open BrightSpeakAPI');
  assert.equal(intent.kind, 'select_repository');
  assert.equal(intent.repositoryName, 'BrightSpeakAPI');
  assert.equal(intent.needsClarification, null);

  assert.equal(routeCodingIntent('work on BrightTales').repositoryName, 'BrightTales');
  assert.equal(routeCodingIntent('select the NovaCourt repo').repositoryName, 'NovaCourt');
});

test('fixing a bug is mutating and therefore never auto-executes', () => {
  const intent = routeCodingIntent('Fix the login bug in BrightSpeakAPI');
  assert.equal(intent.kind, 'fix_bug');
  assert.equal(intent.mutating, true);
  assert.equal(requiresRepository(intent), true);
});

test('investigation requests are read-only', () => {
  const intent = routeCodingIntent('Investigate why this test fails');
  assert.equal(intent.kind, 'investigate_tests');
  assert.equal(intent.mutating, false);
  assert.equal(requiresRepository(intent), true);
});

test('finding code extracts a usable search term', () => {
  const intent = routeCodingIntent('Find where authentication is implemented');
  assert.equal(intent.kind, 'find_code');
  assert.ok(intent.searchTerm && intent.searchTerm.length > 0, 'expected a search term');
  assert.match(intent.searchTerm, /authentication/i);
  assert.equal(intent.mutating, false);
});

test('project explanation and diff requests are read-only', () => {
  assert.equal(routeCodingIntent('Explain this project').kind, 'explain_project');
  assert.equal(routeCodingIntent('Show me what you changed').kind, 'show_changes');
  assert.equal(routeCodingIntent('git diff').kind, 'show_changes');
  assert.equal(routeCodingIntent('Show the diff').kind, 'show_changes');
});

test('cancellation is recognised', () => {
  assert.equal(routeCodingIntent('Cancel the current task').kind, 'cancel_task');
  assert.equal(routeCodingIntent('stop what you are doing').kind, 'cancel_task');
});

test('running tests is mutating because it executes code', () => {
  const intent = routeCodingIntent('Run the approved tests');
  assert.equal(intent.kind, 'run_tests');
  assert.equal(intent.mutating, true, 'executing tests must require approval');
});

test('repository creation is recognised', () => {
  assert.equal(routeCodingIntent('Create a new repository called MyDashboard').kind, 'create_repository');
  assert.equal(extractNewRepositoryName('Create a new repository called MyDashboard'), 'MyDashboard');
  assert.equal(extractNewRepositoryName('create a React app named BrightBoard'), 'BrightBoard');
});

test('stack hints are extracted for the scaffold proposal', () => {
  const hints = extractStackHints('Create a React and TypeScript dashboard called MyDashboard');
  assert.ok(hints.includes('React'));
  assert.ok(hints.includes('TypeScript'));
  assert.ok(hints.includes('Dashboard'));
});

test('ordinary conversation is not turned into a coding action', () => {
  for (const message of [
    'Hi Astra',
    'How are you today?',
    'Tell me a joke',
    'What is the weather like',
  ]) {
    assert.equal(routeCodingIntent(message).kind, 'chitchat', message);
  }
});

test('a question about a coding word is a question, not a command', () => {
  const intent = routeCodingIntent('What does push mean in git?');
  assert.equal(intent.kind, 'chitchat', 'asking about git must not be treated as a git command');
});

test('ambiguous requests ask for clarification instead of guessing', () => {
  const open = routeCodingIntent('Open the project');
  assert.ok(open.needsClarification, 'expected clarification when no repository is named');

  const find = routeCodingIntent('Find where it is implemented');
  assert.equal(find.kind, 'find_code');
});

test('an empty message asks rather than acting', () => {
  assert.ok(routeCodingIntent('').needsClarification);
  assert.ok(routeCodingIntent('   ').needsClarification);
});

test('a hostile repository name cannot smuggle a path', () => {
  const hint = extractRepositoryHint('open ../../etc/passwd');
  // The extractor only ever yields a bare identifier, never a path.
  assert.ok(hint === null || !hint.includes('/') && !hint.includes('\\'), `unsafe hint: ${hint}`);
  assert.equal(sanitiseSearchTerm('../../etc/passwd'), null);
  assert.equal(sanitiseSearchTerm('src\\..\\..\\secret'), null);
});

test('search terms are length-bounded and reject control characters', () => {
  assert.equal(sanitiseSearchTerm('a'.repeat(200)), null);
  assert.equal(sanitiseSearchTerm('valid term'), 'valid term');
  assert.equal(sanitiseSearchTerm('"quoted"'), 'quoted');
  assert.equal(sanitiseSearchTerm(''), null);
});

test('repository hints ignore ordinary English words', () => {
  assert.equal(extractRepositoryHint('open the file'), null);
  assert.equal(extractRepositoryHint('fix the bug'), null);
  assert.ok(extractRepositoryHint('fix the bug in BrightSpeakAPI'));
});

test('every mutating intent requires a repository before it can act', () => {
  for (const message of ['Fix the bug', 'Add a feature', 'Run the tests']) {
    const intent = routeCodingIntent(message);
    assert.equal(intent.mutating, true, message);
    assert.equal(requiresRepository(intent), true, `${message} must require a selected repository`);
  }
});