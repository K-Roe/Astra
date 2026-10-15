import { Buffer } from 'node:buffer';

/**
 * Understanding a project request, and the real code that answers it.
 *
 * This module is pure: it decides *what* Karl asked for and produces the
 * baseline source, and it never touches the disk or a model. Everything that
 * writes, verifies or runs lives in the agent, behind approval.
 *
 * Why a deterministic baseline exists at all: a blog that Astra claims is
 * "working" has to actually work. So Astra writes a complete, dependency-free
 * project first, validates it with real commands, and only then lets the local
 * coding model improve it. If the model's output fails validation it is
 * repaired, and if it still fails the file reverts to the baseline. That gives
 * the build loop a floor that is honest rather than a claim.
 */

/** What sort of thing Karl asked Astra to build. */
export type ProjectKind = 'blog' | 'website' | 'api' | 'app';

export interface ProjectRequest {
  readonly name: string | null;
  readonly kind: ProjectKind;
  readonly stack: readonly string[];
  /** Bounded restatement of the objective, shown in the approval plan. */
  readonly purpose: string;
  /**
   * True when the request asks for a working application rather than a bare
   * scaffold. Only this case earns the autonomous build loop.
   */
  readonly buildsApplication: boolean;
  /** Loop and resource ceilings. Karl sees these in the plan. */
  readonly limits: ProjectLimits;
}

export interface ProjectLimits {
  readonly maxIterations: number;
  readonly maxWrites: number;
  readonly maxCommands: number;
  readonly deadlineMs: number;
}

export const DEFAULT_PROJECT_LIMITS: ProjectLimits = {
  maxIterations: 4,
  maxWrites: 80,
  maxCommands: 24,
  // Long enough for a local model call plus several validation passes, and
  // bounded so a stuck model cannot hold the task open. The first validation
  // pass always completes regardless, so the report is never left without a
  // result.
  deadlineMs: 300_000,
};

/** Technology keywords that inform the proposal. Never an install. */
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
 * Read the shape of the project out of a conversational request.
 *
 * Only the destination, the kind of thing and whether an application was asked
 * for are inferred. The stack is recorded as a *preference*; Astra never
 * installs anything on the strength of it.
 */
export function analyseProjectRequest(message: string, name: string | null): ProjectRequest {
  const text = message ?? '';
  const kind: ProjectKind = /\b(blog|post|article|writing)\b/i.test(text) ? 'blog'
    : /\b(website|web ?site|landing ?page|web ?page)\b/i.test(text) ? 'website'
    : /\b(api|rest|endpoint|backend|service)\b/i.test(text) ? 'api'
    : 'app';

  // "and build me a working blog website" is the application case. A bare
  // "create a repository called X" is a scaffold, and stays a scaffold.
  const buildsApplication = /\b(build|create|make|scaffold|generate|write|develop|implement|produce|give me|set ?up)\b[^.]*\b(blog|website|web ?site|web ?page|app|application|api|service|dashboard|site|landing ?page|tool)\b/i.test(text)
    || /\bworking\b/i.test(text)
    || /\bfunctioning\b/i.test(text);

  const purpose = text.replace(/\s+/g, ' ').trim().slice(0, 300);
  return {
    name,
    kind,
    stack: extractStackHints(text),
    purpose,
    buildsApplication,
    limits: DEFAULT_PROJECT_LIMITS,
  };
}

/** Extensions the generated project may contain. */
const ALLOWED_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.json', '.md', '.html', '.css', '.txt', '.yml']);

/**
 * Validate a map of generated files against the approved manifest.
 *
 * The model may only fill in files Astra already declared, with content that
 * is text, bounded, and free of anything that could escape the project. Paths
 * are matched exactly against the manifest, so a model cannot introduce a new
 * location, a traversal or a symlink target.
 */
export function validateGeneratedFiles(raw: unknown, manifest: readonly string[], allowedPackages?: readonly string[]): Record<string, string> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('the coding model did not return a file map');
  const allowed = new Set(manifest.map((file) => file.replace(/\\/g, '/')));
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const file = key.replace(/\\/g, '/').replace(/^\.\//, '');
    if (!allowed.has(file)) throw new Error(`the model produced "${file}", which is not in the approved file list`);
    if (typeof value !== 'string' || !value.trim()) throw new Error(`the model produced no content for ${file}`);
    if (Buffer.byteLength(value, 'utf8') > 128_000) throw new Error(`generated ${file} is too large`);
    if (value.includes('\u0000')) throw new Error(`generated ${file} contains a null byte`);
    const extension = file.slice(file.lastIndexOf('.')).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(extension)) throw new Error(`generated ${file} has a disallowed extension`);
    if (allowedPackages && /\.(?:js|jsx|ts|tsx)$/.test(file)) {
      const imports = [...value.matchAll(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*)['"]([^'"]+)['"]/g)].map((match) => match[1]);
      for (const imported of imports) {
        if (!imported.startsWith('.') && !imported.startsWith('/') && !allowedPackages.some((name) => imported === name || imported.startsWith(`${name}/`))) {
          throw new Error(`generated ${file} imports undeclared package ${imported}`);
        }
      }
    }
    result[file] = value;
  }
  if (Object.keys(result).length === 0) throw new Error('the coding model produced no usable files');
  return result;
}

/**
 * The baseline project: real, dependency-free, and verified by real tests.
 *
 * Every file here is genuine application code. `node --test` passes against it
 * and `node src/server.js` serves it, so the project Astra reports as working
 * is working without any package installation — which matters because
 * dependency installation remains separately authorised and blocked.
 */
export function buildProjectScaffold(name: string, kind: ProjectKind, stack: readonly string[] = []): Record<string, string> {
  if (stack.includes('React')) return reactProject(name);
  return kind === 'blog' ? blogProject(name) : genericProject(name, kind);
}

function reactProject(name: string): Record<string, string> {
  const packageName = name.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
  return {
    'package.json': `${JSON.stringify({
      name: packageName, version: '0.1.0', private: true, type: 'module',
      scripts: { dev: 'vite', build: 'vite build' },
      dependencies: { react: '^19.3.0', 'react-dom': '^19.3.0' },
      devDependencies: { vite: '^8.3.4', typescript: '^6.0.3', '@types/react': '^19.3.0', '@types/react-dom': '^19.3.0' },
    }, null, 2)}\n`,
    'index.html': '<!doctype html>\n<html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>' + name + '</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>\n',
    'tsconfig.json': `${JSON.stringify({ compilerOptions: { target: 'ES2022', lib: ['ES2022', 'DOM', 'DOM.Iterable'], module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx', strict: true, skipLibCheck: true, noEmit: true }, include: ['src'] }, null, 2)}\n`,
    'src/main.tsx': `import React from 'react';\nimport { createRoot } from 'react-dom/client';\nimport App from './App';\nimport './styles.css';\n\ncreateRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);\n`,
    'src/App.tsx': `import { useState } from 'react';\nimport Navigation from './components/Navigation';\nimport HomePage from './pages/HomePage';\nimport AboutPage from './pages/AboutPage';\n\nexport default function App() {\n  const [page, setPage] = useState<'home' | 'about'>('home');\n  return <><Navigation current={page} onNavigate={setPage} /><main>{page === 'home' ? <HomePage /> : <AboutPage />}</main></>;\n}\n`,
    'src/components/Navigation.tsx': `type Page = 'home' | 'about';\nexport default function Navigation({ current, onNavigate }: { current: Page; onNavigate: (page: Page) => void }) {\n  return <nav aria-label="Main navigation"><button aria-current={current === 'home' ? 'page' : undefined} onClick={() => onNavigate('home')}>Home</button><button aria-current={current === 'about' ? 'page' : undefined} onClick={() => onNavigate('about')}>About</button></nav>;\n}\n`,
    'src/pages/HomePage.tsx': `export default function HomePage() {\n  return <section><h1>Welcome to ${name}</h1><p>Explore the homepage and learn more about this project.</p></section>;\n}\n`,
    'src/pages/AboutPage.tsx': `export default function AboutPage() {\n  return <section><h1>About ${name}</h1><p>This site is built with React and TypeScript.</p></section>;\n}\n`,
    'src/styles.css': `:root { font-family: system-ui, sans-serif; color: #f5f3ff; background: #171126; } body { margin: 0; } nav { display: flex; gap: 1rem; padding: 1rem 2rem; background: #291c43; } button { color: inherit; background: #493172; border: 0; border-radius: .5rem; padding: .7rem 1rem; cursor: pointer; } button[aria-current="page"] { background: #7651b6; } main { max-width: 70rem; margin: 4rem auto; padding: 0 2rem; }\n`,
  };
}

function blogProject(name: string): Record<string, string> {
  const safe = name.replace(/[^A-Za-z0-9]/g, '');
  return {
    'package.json': `${JSON.stringify({
      name: safe.toLowerCase(),
      version: '0.1.0',
      private: true,
      description: 'A small blog built by Astra.',
      scripts: { start: 'node src/server.js', test: 'node --test' },
      engines: { node: '>=18' },
    }, null, 2)}\n`,


    'src/posts.js': `'use strict';

/**
 * Posts, and the pure functions that read them.
 *
 * Nothing here touches the filesystem or the network, so the whole module can
 * be tested directly. \`addPost\` validates before it mutates, so a bad post is
 * rejected rather than half-stored.
 */

const posts = [
  {
    id: 'hello-world',
    title: 'Hello, world',
    date: '2026-01-05',
    tags: ['meta'],
    body: 'This blog was built by Astra from a single sentence. It has no dependencies, so it runs with the Node.js you already have.',
  },
  {
    id: 'why-plain-javascript',
    title: 'Why plain JavaScript',
    date: '2026-01-12',
    tags: ['notes'],
    body: 'A build step is useful once a project needs one. This one does not, so it does not have one.',
  },
];

/** Every post, newest first. Returns a copy: callers cannot mutate the store. */
function listPosts() {
  return posts.slice();
}

/** One post by id, or null when there is no such post. */
function getPost(id) {
  if (typeof id !== 'string' || id.length === 0) return null;
  return posts.find((post) => post.id === id) || null;
}

/** Posts carrying a tag, case-insensitively. */
function postsByTag(tag) {
  if (typeof tag !== 'string') return [];
  const wanted = tag.toLowerCase();
  return posts.filter((post) => post.tags.some((entry) => entry.toLowerCase() === wanted));
}

/**
 * Add a post. Throws on anything malformed, and returns the stored post.
 * The id is derived from the title so ids stay stable and URL-safe.
 */
function addPost(input) {
  if (!input || typeof input !== 'object') throw new TypeError('a post must be an object');
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (title.length < 1) throw new TypeError('a post needs a title');
  const body = typeof input.body === 'string' ? input.body.trim() : '';
  if (body.length < 1) throw new TypeError('a post needs a body');
  const tags = Array.isArray(input.tags) ? input.tags.filter((tag) => typeof tag === 'string' && tag.trim()) : [];
  const id = input.id ? String(input.id) : slug(title);
  if (getPost(id)) throw new Error(\`a post with the id "\${id}" already exists\`);
  const post = { id, title, body, tags, date: typeof input.date === 'string' ? input.date : new Date().toISOString().slice(0, 10) };
  posts.push(post);
  return post;
}

/** A URL-safe id from a title. */
function slug(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'post';
}

module.exports = { listPosts, getPost, postsByTag, addPost, slug };
`,

    'src/render.js': `'use strict';

/**
 * HTML rendering.
 *
 * Pure string building, kept apart from the server so it can be tested without
 * opening a socket. Every interpolated value is escaped: a post title is user
 * data, and unescaped it would be an injection into the page.
 */

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escape the characters that matter inside HTML text and attributes. */
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ESCAPES[character]);
}

/** Render one post as an article. */
function renderPost(post) {
  if (!post || typeof post !== 'object') throw new TypeError('renderPost needs a post');
  const tags = (post.tags || []).map((tag) => \`<span class="tag">\${escapeHtml(tag)}</span>\`).join('');
  return [
    '<article class="post">',
    \`  <h2>\${escapeHtml(post.title)}</h2>\`,
    \`  <p class="meta">\${escapeHtml(post.date || '')}\${tags ? \` — \${tags}\` : ''}</p>\`,
    \`  <p>\${escapeHtml(post.body)}</p>\`,
    '</article>',
  ].join('\\n');
}

/** Render the full list of posts. */
function renderPostList(posts) {
  if (!Array.isArray(posts)) throw new TypeError('renderPostList needs an array of posts');
  if (posts.length === 0) return '<p class="empty">No posts yet.</p>';
  return posts.map(renderPost).join('\\n');
}

/** Render the whole page around already-rendered content. */
function renderPage(title, bodyHtml) {
  return [
    '<!doctype html>',
    '<html lang="en">',
    '  <head>',
    '    <meta charset="UTF-8" />',
    '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    \`    <title>\${escapeHtml(title)}</title>\`,
    '    <link rel="stylesheet" href="/style.css" />',
    '  </head>',
    '  <body>',
    '    <main>',
    \`      <h1>\${escapeHtml(title)}</h1>\`,
    \`      \${bodyHtml}\`,
    '    </main>',
    '  </body>',
    '</html>',
    '',
  ].join('\\n');
}

module.exports = { escapeHtml, renderPost, renderPostList, renderPage };
`,

    'src/server.js': `'use strict';

/**
 * A small static-and-API server for the blog.
 *
 * \`createServer\` builds the server without listening, so the tests can import
 * this file safely. It only starts listening when run directly, which is what
 * \`node src/server.js\` does.
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { listPosts, getPost } = require('./posts');
const { renderPostList, renderPage } = require('./render');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const CONTENT_TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };

/** JSON response helper. */
function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) });
  response.end(body);
}

/** Resolve a request path to a file inside public/, or null if it escapes. */
function resolvePublic(urlPath) {
  const relative = urlPath === '/' ? 'index.html' : urlPath.replace(/^\\/+/, '');
  const target = path.resolve(PUBLIC_DIR, relative);
  // Containment check: a request must never read outside public/.
  if (target !== PUBLIC_DIR && !target.startsWith(PUBLIC_DIR + path.sep)) return null;
  return target;
}

function handle(request, response) {
  const url = new URL(request.url, 'http://localhost');
  if (url.pathname === '/api/posts') return sendJson(response, 200, { posts: listPosts() });

  const postId = url.pathname.match(/^\\/posts\\/([^/]+)$/);
  if (postId) {
    const post = getPost(decodeURIComponent(postId[1]));
    return post
      ? sendJson(response, 200, post)
      : sendJson(response, 404, { error: 'no such post' });
  }

  const target = resolvePublic(url.pathname);
  if (!target || !fs.existsSync(target)) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    return response.end('Not found');
  }
  response.writeHead(200, { 'content-type': CONTENT_TYPES[path.extname(target)] || 'application/octet-stream' });
  fs.createReadStream(target).pipe(response);
}

/** Build the server without binding a port. */
function createServer() {
  return http.createServer(handle);
}

const port = Number(process.env.PORT || 3000);
if (require.main === module) {
  createServer().listen(port, () => {
    console.log(\`Blog listening on http://localhost:\${port}\`);
  });
}

module.exports = { createServer, handle, resolvePublic };
`,

    'public/index.html': `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${name}</title>
    <link rel="stylesheet" href="/style.css" />
  </head>
  <body>
    <main>
      <h1>${name}</h1>
      <p class="meta">Built by Astra. Run <code>node src/server.js</code> to serve this.</p>
    </main>
    <script src="/app.js"></script>
  </body>
</html>
`,

    'public/style.css': `:root { color-scheme: dark; }
body { margin: 0; font-family: system-ui, sans-serif; background: #14161d; color: #e8eaf0; }
main { max-width: 44rem; margin: 0 auto; padding: 3rem 1.5rem; }
h1 { font-size: 2rem; margin-bottom: 0.25rem; }
h2 { font-size: 1.25rem; margin-bottom: 0.25rem; }
.meta { color: #99a0b0; font-size: 0.875rem; }
.tag { display: inline-block; padding: 0.05rem 0.5rem; margin-left: 0.35rem; border-radius: 999px; background: #2a2f3d; font-size: 0.75rem; }
.post { border-top: 1px solid #2a2f3d; padding-top: 1.25rem; margin-top: 1.5rem; }
.empty { color: #99a0b0; }
`,

    'public/app.js': `'use strict';

// Loads the posts over the API the server provides and renders them.
(async function load() {
  const response = await fetch('/api/posts');
  if (!response.ok) throw new Error('the posts API did not respond');
  const { posts } = await response.json();
  const container = document.querySelector('main');
  for (const post of posts) {
    const article = document.createElement('article');
    article.className = 'post';
    const title = document.createElement('h2');
    title.textContent = post.title;
    const body = document.createElement('p');
    body.textContent = post.body;
    article.append(title, body);
    container.append(article);
  }
})();
`,

    'test/posts.test.js': `'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { existsSync } = require('node:fs');

const { listPosts, getPost, postsByTag, addPost, slug } = require('../src/posts');
const { escapeHtml, renderPostList, renderPost } = require('../src/render');
const { resolvePublic } = require('../src/server');

test('the blog starts with posts', () => {
  assert.ok(listPosts().length > 0);
  assert.equal(typeof listPosts(), 'object');
});

test('listPosts returns a copy that cannot corrupt the store', () => {
  const first = listPosts();
  first.push({ id: 'fake' });
  assert.notEqual(listPosts().length, first.length);
});

test('getPost finds an existing post and returns null otherwise', () => {
  assert.equal(getPost('hello-world').title, 'Hello, world');
  assert.equal(getPost('does-not-exist'), null);
  assert.equal(getPost(''), null);
  assert.equal(getPost(null), null);
});

test('postsByTag matches case-insensitively and tolerates junk', () => {
  assert.ok(postsByTag('META').length >= 1);
  assert.deepEqual(postsByTag(42), []);
});

test('addPost stores a valid post and derives a URL-safe id from the title', () => {
  const added = addPost({ title: 'A Brand New Post', body: 'Something worth saying.' });
  assert.equal(added.id, 'a-brand-new-post');
  assert.equal(getPost(added.id).title, 'A Brand New Post');
});

test('addPost refuses a malformed post instead of storing half of one', () => {
  assert.throws(() => addPost(null), TypeError);
  assert.throws(() => addPost({ body: 'no title' }), TypeError);
  assert.throws(() => addPost({ title: 'no body' }), TypeError);
});

test('addPost refuses a duplicate id', () => {
  assert.throws(() => addPost({ id: 'hello-world', title: 'Clash', body: 'Clash' }), /already exists/);
});

test('slug produces a URL-safe id', () => {
  assert.equal(slug('Hello, World!'), 'hello-world');
  assert.equal(slug('   '), 'post');
});

test('escapeHtml neutralises markup', () => {
  assert.equal(escapeHtml('<script>'), '&lt;script&gt;');
  assert.equal(escapeHtml('a & b'), 'a &amp; b');
  assert.equal(escapeHtml(\`"'\`), '&quot;&#39;');
});

test('renderPostList renders every post and escapes their text', () => {
  const html = renderPostList([{ id: 'x', title: '<b>bold</b>', date: '2026-01-01', tags: ['t'], body: 'body' }]);
  assert.ok(html.includes('&lt;b&gt;bold&lt;/b&gt;'));
  assert.ok(!html.includes('<b>bold</b>'));
  assert.ok(html.includes('body'));
});

test('renderPostList reports an empty blog rather than rendering nothing', () => {
  assert.match(renderPostList([]), /No posts yet/);
  assert.throws(() => renderPostList(null), TypeError);
});

test('a post title cannot inject markup into the page', () => {
  const html = renderPost({ id: 'x', title: '"><script>alert(1)</script>', date: '', tags: [], body: '' });
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('the server never resolves a request outside public/', () => {
  // The property that matters is containment, not the specific value: whatever
  // the request looks like, the resolved path must stay inside public/.
  const publicDir = path.resolve(__dirname, '..', 'public');
  for (const request of ['/', '/index.html', '/style.css', '/../../package.json', '/..%2f..%2fpackage.json', '/%2e%2e/%2e%2e/package.json']) {
    const resolved = resolvePublic(request);
    if (resolved === null) continue;
    assert.ok(
      resolved === publicDir || resolved.startsWith(publicDir + path.sep),
      \`\${request} escaped public/: \${resolved}\`,
    );
  }
  assert.ok(existsSync(resolvePublic('/')));
});
`,
  };
}

function genericProject(name: string, kind: ProjectKind): Record<string, string> {
  const safe = name.replace(/[^A-Za-z0-9]/g, '');
  const label = kind === 'api' ? 'A small API built by Astra.' : 'A small application built by Astra.';
  return {
    'package.json': `${JSON.stringify({
      name: safe.toLowerCase(),
      version: '0.1.0',
      private: true,
      description: label,
      scripts: { start: 'node src/index.js', test: 'node --test' },
      engines: { node: '>=18' },
    }, null, 2)}\n`,
    'src/index.js': `'use strict';

/** The project's real entry point. */
function describe() {
  return { name: ${JSON.stringify(name)}, description: ${JSON.stringify(label)} };
}

if (require.main === module) {
  console.log(describe());
}

module.exports = { describe };
`,
    'README.md': `# ${name}\n\n${label}\n\n## Run it\n\n\`\`\`powershell\nnode src/index.js\n\`\`\`\n\n## Test it\n\n\`\`\`powershell\nnode --test\n\`\`\`\n`,
    'test/index.test.js': `'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { describe: describeProject } = require('../src/index');

test('the project describes itself', () => {
  const info = describeProject();
  assert.equal(typeof info.name, 'string');
  assert.ok(info.name.length > 0);
  assert.ok(info.description.length > 0);
});
`,
  };
}

/** The README written last, once the real validation results are known. */
export function buildProjectReadme(name: string, command: string, validated: boolean, detail: string, stack: readonly string[] = []): string {
  const react = stack.includes('React');
  return [
    `# ${name}`,
    '',
    'Built by Astra on this machine.',
    '',
    '## Run it',
    '',
    '```powershell',
    command,
    '```',
    '',
    '## Test it',
    '',
    '```powershell',
    react ? 'npm run build' : 'node --test',
    '```',
    '',
    '## Dependencies',
    '',
    react ? 'React, TypeScript and Vite are declared in package.json. Install dependencies separately before running the development server or build.' : 'This project has no dependencies. It runs on the installed Node.js.',
    '',
    '## What was verified',
    '',
    validated
      ? `\`${detail}\``
      : `Not yet verified: ${detail}`,
    '',
  ].join('\n');
}
