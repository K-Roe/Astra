import assert from 'node:assert/strict';
import test from 'node:test';
import net from 'node:net';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { AstraDatabase } = require('../dist-electron/main/knowledge/database.js');
const { ApprovalManager } = require('../dist-electron/main/approvals/approvalManager.js');
const { TaskStore } = require('../dist-electron/main/agent/taskStore.js');
const { MemoryStore } = require('../dist-electron/main/knowledge/memoryStore.js');
const { CodingAgent } = require('../dist-electron/main/agent/codingAgent.js');
const { CodingBridge } = require('../dist-electron/main/agent/codingBridge.js');
const { routeCodingIntent } = require('../dist-electron/main/agent/codingIntent.js');
const { detectMemoryIntent } = require('../dist-electron/main/memory/memoryIntents.js');
const { inspectPath, inspectLocalService } = require('../dist-electron/main/workspace/verification.js');
const { ChatService, MODEL_DIGEST, unverifiedClaimKind } = require('../dist-electron/main/chatService.js');

/**
 * Regression tests for the false project/filesystem/service claims.
 *
 * The reported failure was Astra telling Karl that a repository existed at
 * `C:\Users\karlr\repos\Astra's Blog`, that a website was live on
 * http://localhost:3000, and that she had recorded the location in memory —
 * none of which had happened. Every test below pins one link in that chain:
 * routing, verification, or the refusal to report an unverified claim.
 *
 * Karl's real repositories are never touched; everything runs in a temporary
 * directory, exactly as the other agent tests do.
 */

const CLAIMED_PATH = "C:\\Users\\karlr\\repos\\Astra's Blog";

function lab() {
  const base = mkdtempSync(path.join(tmpdir(), 'astra-claims-'));
  const root = path.join(base, 'repos');
  mkdirSync(root, { recursive: true });
  const db = new AstraDatabase(path.join(base, 'astra.db'));
  db.migrate();
  const approvals = new ApprovalManager(db);
  const agent = new CodingAgent({ root }, approvals, new TaskStore(db), new MemoryStore(db));
  const cleanup = () => {
    try { db.close(); } catch { /* Already closed. */ }
    rmSync(base, { recursive: true, force: true });
  };
  return { base, root, sandbox: { root }, agent, cleanup };
}

// --------------------------------------------------------------- routing

test('a request to create a project never falls through to the chat model', () => {
  // The defect: these phrasings matched no rule, became `chitchat`, and were
  // handed to Gemma, which invented the repository, its path and its URL.
  for (const request of [
    "Create a new blog website called Astra's Blog",
    "Can you make me a blog called Astra's Blog?",
    "Set up a blog called Astra's Blog",
    "I want a website called Astra's Blog for my writing",
    "Make a folder called Astra's Blog for blog posts",
    "Create a folder called Blog inside my repositories",
    "Start a website called Astra's Blog at http://localhost:3000",
  ]) {
    const intent = routeCodingIntent(request);
    assert.equal(intent.kind, 'create_repository', request);
    assert.notEqual(intent.kind, 'chitchat', `${request} must not reach the language model`);
  }
});

test('a creation request is never demoted to a read-only listing', () => {
  // "…inside my repositories" used to match `list_repositories`, silently
  // turning a mutating request into a read-only one.
  const intent = routeCodingIntent('Create a folder called Blog inside my repositories');
  assert.equal(intent.kind, 'create_repository');
  assert.equal(intent.mutating, true, 'a creation request must still require approval');
});

test('a request about a local service is routed to a real probe', () => {
  for (const request of [
    'Is the website running on localhost:3000?',
    'Start the dev server',
    'Run the blog on port 3000',
    'Open the website at localhost:3000 and tell me what it shows',
    'Is anything listening on 127.0.0.1:8080?',
  ]) {
    assert.equal(routeCodingIntent(request).kind, 'check_service', request);
  }
  assert.equal(routeCodingIntent('Is the website running on localhost:3000?').serviceUrl, 'http://localhost:3000');
});

test('existence and location questions are routed to a filesystem check', () => {
  for (const request of [
    `Does ${CLAIMED_PATH} exist?`,
    'Where is the blog repository located?',
    `Is ${CLAIMED_PATH} there?`,
    'Does the project directory exist?',
  ]) {
    assert.equal(routeCodingIntent(request).kind, 'check_path', request);
  }
  assert.equal(routeCodingIntent(`Does ${CLAIMED_PATH} exist?`).path, CLAIMED_PATH);
});

test('a question about whether something is a Git repository is routed to a check', () => {
  for (const request of [
    `Is ${CLAIMED_PATH} a git repository?`,
    'Check whether the blog is a git repo',
    'Is that folder version controlled?',
  ]) {
    assert.equal(routeCodingIntent(request).kind, 'check_repository', request);
  }
});

test('a message naming a path, a service or a project can never be chitchat', () => {
  // The structural guarantee behind the individual rules: the fallback used to
  // be the language model, so any unenumerated phrasing became a fabrication.
  // A bare noun with no claim in it is still conversation — there is nothing to
  // check — but anything that asserts or names a filesystem or service
  // subject must reach a tool.
  for (const request of [
    CLAIMED_PATH,
    `${CLAIMED_PATH} is where the blog lives`,
    'localhost:3000',
    'the dev server',
    'port 4200',
    'is the blog project there',
    'where is the blog repository',
  ]) {
    assert.notEqual(routeCodingIntent(request).kind, 'chitchat', `"${request}" must reach a tool`);
  }
});

test('genuine conversation is still conversation', () => {
  // The fix must not have made Astra incapable of talking.
  for (const message of ['Hi Astra', 'How are you today?', 'Tell me a joke', 'What is the weather like']) {
    assert.equal(routeCodingIntent(message).kind, 'chitchat', message);
  }
});

test('a memory request reaches the memory service instead of the model', () => {
  // "Save a memory that …" matched no memory intent, so it fell through and
  // produced an invented confirmation.
  const intent = detectMemoryIntent('Save a memory that the blog lives in the repos folder');
  assert.ok(intent, 'expected a memory instruction');
  assert.equal(intent.kind, 'remember');
  assert.equal(intent.text, 'the blog lives in the repos folder');
  // "save the file" is a coding request and must never become a memory.
  assert.equal(detectMemoryIntent('Save the file to disk'), null);
  assert.equal(routeCodingIntent('Save a memory that the blog lives in the repos folder').kind, 'chitchat');
});

// ---------------------------------------------------------- verification

test('a path that does not exist is reported as absent, never as created', () => {
  const { root, sandbox, cleanup } = lab();
  try {
    const inspection = inspectPath(path.join(root, "Astra's Blog"), sandbox);
    assert.equal(inspection.exists, false);
    assert.equal(inspection.kind, 'missing');
    assert.equal(inspection.isGitRepository, false);
  } finally { cleanup(); }
});

test('a real Git repository is distinguished from a plain directory', () => {
  const { root, sandbox, cleanup } = lab();
  try {
    const repo = path.join(root, 'BlogRepo');
    const plain = path.join(root, 'PlainFolder');
    mkdirSync(repo, { recursive: true });
    mkdirSync(plain, { recursive: true });
    execFileSync('git', ['init', '-q', repo], { stdio: 'ignore' });

    const withGit = inspectPath(repo, sandbox, 'main');
    assert.equal(withGit.exists, true);
    assert.equal(withGit.kind, 'directory');
    assert.equal(withGit.isGitRepository, true);
    assert.equal(withGit.branch === null || typeof withGit.branch === 'string', true);

    // A directory full of files but with no .git is NOT a repository.
    const withoutGit = inspectPath(plain, sandbox);
    assert.equal(withoutGit.exists, true);
    assert.equal(withoutGit.isGitRepository, false);
    assert.equal(withoutGit.branch, null);
  } finally { cleanup(); }
});

test('verification refuses to inspect outside the approved root', () => {
  const { sandbox, cleanup } = lab();
  try {
    const inspection = inspectPath('C:\\Windows\\System32', sandbox);
    assert.equal(inspection.exists, false);
    assert.ok(inspection.unavailable, 'a refusal to inspect must be reported, not silently swallowed');
    assert.match(inspection.unavailable, /approved root/i);
  } finally { cleanup(); }
});

test('a closed loopback port is reported as not listening', async () => {
  const { cleanup } = lab();
  try {
    const server = net.createServer();
    const port = await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
    try {
      const live = await inspectLocalService(`http://127.0.0.1:${port}`);
      assert.equal(live.listening, true, 'a real open port must be detected');

      await new Promise((resolve) => server.close(resolve));
      const dead = await inspectLocalService(`http://127.0.0.1:${port}`, 500);
      assert.equal(dead.listening, false);
      assert.ok(dead.unavailable, 'an unreachable service must carry its reason');
    } finally {
      try { server.close(); } catch { /* Already closed. */ }
    }
  } finally { cleanup(); }
});

test('a non-loopback address is refused rather than probed', async () => {
  const { cleanup } = lab();
  try {
    const service = await inspectLocalService('http://example.com:80', 200);
    assert.equal(service.listening, false);
    assert.match(service.unavailable, /only checks services on this machine/i);
  } finally { cleanup(); }
});

// -------------------------------------------------------------- the bridge

test('the bridge verifies a claimed project instead of inventing one', async () => {
  const { root, sandbox, agent, cleanup } = lab();
  try {
    const bridge = new CodingBridge(agent, sandbox);
    const result = await bridge.handle(`Does ${CLAIMED_PATH} exist?`);
    assert.ok(result, 'the request must be handled by a tool, not passed to the model');
    assert.equal(result.handled, true);
    // The path in Karl's message is outside the temporary sandbox, so Astra
    // must say it could not verify rather than assert either way.
    assert.match(result.reply, /will not inspect paths outside the approved root/i);

    const inside = await bridge.handle('Does the blog project exist?');
    assert.match(inside.reply, /no projects under/i);
    assert.match(inside.reply, /has not created anything/i);
    assert.equal(existsSync(path.join(root, "Astra's Blog")), false);
  } finally { cleanup(); }
});

test('the bridge reports a real repository as a repository and a plain folder as not one', async () => {
  const { root, sandbox, agent, cleanup } = lab();
  try {
    const repo = path.join(root, 'BlogRepo');
    mkdirSync(repo, { recursive: true });
    execFileSync('git', ['init', '-q', repo], { stdio: 'ignore' });
    mkdirSync(path.join(root, 'NotARepo'), { recursive: true });
    writeFileSync(path.join(root, 'NotARepo', 'index.js'), 'export default {};\n');

    const bridge = new CodingBridge(agent, sandbox);
    const yes = await bridge.handle(`Is ${repo} a git repository?`);
    assert.match(yes.reply, /Verified: yes/i);

    const no = await bridge.handle(`Is ${path.join(root, 'NotARepo')} a git repository?`);
    assert.match(no.reply, /Verified: no/i);
    assert.match(no.reply, /has not run `git init`/i);
  } finally { cleanup(); }
});

test('a proposed project never claims a running website', async () => {
  const { root, sandbox, agent, cleanup } = lab();
  try {
    const bridge = new CodingBridge(agent, sandbox);
    const result = await bridge.handle('Create a new blog website called BlogTarget at http://localhost:3000');
    assert.ok(result);
    // Nothing exists until Karl approves, and Astra says so.
    assert.match(result.reply, /Review the Coding workspace proposal and approve/i);
    assert.doesNotMatch(result.reply, /is (?:now )?(?:running|available|live)/i);
    // And it states the limitation rather than implying a server was started.
    assert.match(result.reply, /cannot start a web server/i);
    assert.equal(existsSync(path.join(root, 'BlogTarget')), false, 'proposal must not create anything');
  } finally { cleanup(); }
});

test('a service check without an address explains what Astra can do', async () => {
  const { sandbox, agent, cleanup } = lab();
  try {
    const bridge = new CodingBridge(agent, sandbox);
    const result = await bridge.handle('Start the dev server');
    assert.ok(result);
    assert.match(result.reply, /give it as a loopback address/i);
    assert.match(result.reply, /will open a connection/i);
  } finally { cleanup(); }
});

// --------------------------------------------------------- generated claims

test('every class of unsupported claim is detected', () => {
  // These are the sentences Astra actually produced, or close to them.
  const cases = [
    ["The repository is now located at C:\\Users\\karlr\\repos\\Astra's Blog.", 'location'],
    ['A website is available at http://localhost:3000.', 'service'],
    ['The site is running on localhost:3000.', 'service'],
    ['That folder is a git repository.', 'git'],
    ['The project directory exists.', 'location'],
    ['I created the file AstraBackstory.js.', 'file'],
    ["I've saved that to your memory.", 'memory'],
    ["I recorded that in memory.", 'memory'],
  ];
  for (const [sentence, kind] of cases) {
    assert.equal(unverifiedClaimKind(sentence), kind, sentence);
  }
});

test('ordinary conversation and honest answers are not flagged', () => {
  for (const sentence of [
    'Hello Karl, how can I help?',
    'That is a nice project name.',
    'I cannot see the filesystem from here.',
    'I have not checked that path yet.',
    'The documentation describes a repository as a folder containing Git metadata.',
  ]) {
    assert.equal(unverifiedClaimKind(sentence), null, sentence);
  }
});

test('Gemma prose cannot report an unverified project, service or memory claim as done', async () => {
  // The chat model is the component that produced the original fabrication, so
  // the guarantee is enforced on its raw output before it reaches Karl.
  const replies = {
    location: 'The repository is now located at C:\\Users\\karlr\\repos\\Astra\'s Blog.',
    service: 'A website is available at http://localhost:3000.',
    git: 'That folder is a git repository.',
    memory: "I've recorded that in memory.",
  };

  for (const [kind, content] of Object.entries(replies)) {
    const request = async (url) => new globalThis.URL(url).pathname === '/api/chat'
      ? globalThis.Response.json({ message: { role: 'assistant', content } })
      : globalThis.Response.json({
          models: [{ name: 'gemma3:4b', digest: MODEL_DIGEST }],
          details: { runner: 'llamacpp' },
        });
    const service = new ChatService('Astra personality', request);
    const status = await service.send('Where is the blog?');
    const answer = status.messages.at(-1).content;
    assert.doesNotMatch(answer, /Astra's Blog\.?$/m, kind);
    assert.doesNotMatch(answer, /localhost:3000/i, kind);
    assert.match(answer, /have not (?:checked|saved|read|verified)/i, `${kind}: ${answer}`);
    assert.match(status.detail, /No (?:local service was contacted|filesystem check was run|Git metadata was read|personal memory was changed)/i, kind);
    service.shutdown();
  }
});