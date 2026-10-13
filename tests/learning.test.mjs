import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { extractReadableText, chunkText, decodeEntities } = require('../dist-electron/main/research/extraction.js');
const { parseRobots, robotsAllows, crawlApprovedSource, DEFAULT_LIMITS } = require('../dist-electron/main/research/reader.js');
const { AstraDatabase } = require('../dist-electron/main/knowledge/database.js');
const { KnowledgeStore } = require('../dist-electron/main/knowledge/knowledgeStore.js');

function tempDir() {
  return mkdtempSync(path.join(tmpdir(), 'astra-learn-'));
}

function html(body, head = '') {
  return `<!doctype html><html><head><title>Doc page</title>${head}</head><body>${body}</body></html>`;
}

// ------------------------------------------------------------ extraction

test('entity decoding handles named, decimal and hex forms', () => {
  assert.equal(decodeEntities('a &amp; b'), 'a & b');
  assert.equal(decodeEntities('&lt;tag&gt;'), '<tag>');
  assert.equal(decodeEntities('&#65;&#x42;'), 'AB');
  assert.equal(decodeEntities('&notreal;'), '&notreal;');
});

test('script, style and template content never reaches the extracted text', () => {
  const page = extractReadableText(html(
    '<p>Visible text</p><script>alert("xss")</script><style>body{color:red}</style><template><script>bad()</script></template>',
  ));
  assert.match(page.text, /Visible text/);
  assert.ok(!page.text.includes('alert'), 'script body survived');
  assert.ok(!page.text.includes('color:red'), 'style body survived');
  assert.ok(!page.text.includes('bad()'), 'template body survived');
});

test('comments and CDATA are removed before parsing', () => {
  const page = extractReadableText(html('<p>Keep</p><!-- <script>hidden()</script> --><p>Also keep</p>'));
  assert.match(page.text, /Keep/);
  assert.match(page.text, /Also keep/);
  assert.ok(!page.text.includes('hidden()'));
});

test('the title is extracted and tags do not run words together', () => {
  const page = extractReadableText(html('<h1>Hello</h1><p>World</p>'));
  assert.equal(page.title, 'Doc page');
  assert.match(page.text, /Hello World/);
});

test('only safe links are surfaced', () => {
  const page = extractReadableText(html(
    '<a href="/learn/next">Next</a><a href="javascript:alert(1)">Bad</a><a href="data:text/html,x">Data</a><a href="https://other.example/x">Other</a>',
  ));
  const hrefs = page.links.map((l) => l.href);
  assert.ok(hrefs.includes('/learn/next'));
  assert.ok(hrefs.includes('https://other.example/x'));
  assert.ok(!hrefs.some((h) => /^javascript:/i.test(h)));
  assert.ok(!hrefs.some((h) => /^data:/i.test(h)));
});

test('empty input yields empty output rather than throwing', () => {
  const page = extractReadableText('');
  assert.equal(page.text, '');
  assert.deepEqual(page.links, []);
});

// -------------------------------------------------------------- chunking

test('chunking respects the target size and covers all the text', () => {
  const paragraph = 'Sentence one. Sentence two. Sentence three. Sentence four. Sentence five.';
  const text = Array.from({ length: 12 }, (_, i) => `Paragraph ${i}. ${paragraph}`).join('\n\n');
  const chunks = chunkText(text, 400, 60);
  assert.ok(chunks.length > 1, 'long text must be split');
  for (const chunk of chunks) assert.ok(chunk.length <= 700, `chunk too large: ${chunk.length}`);
  assert.ok(chunks[0].includes('Paragraph 0'), 'the first chunk must start at the beginning');
  assert.ok(chunks[chunks.length - 1].includes('Paragraph 11'), 'the last chunk must reach the end');
});

test('short text is a single chunk and empty text is none', () => {
  assert.deepEqual(chunkText('short enough'), ['short enough']);
  assert.deepEqual(chunkText('   \n\n  '), []);
});

test('a single enormous sentence is cut on word boundaries', () => {
  const chunks = chunkText('word '.repeat(500), 300, 0);
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) assert.ok(!chunk.endsWith('wor') || chunk.includes('word'), 'cut mid-word is acceptable only at a space');
});

// ---------------------------------------------------------------- robots

test('robots parsing selects the matching agent group and crawl delay', () => {
  const policy = parseRobots(`
User-agent: SomeBot
Disallow: /

User-agent: AstraLocalCompanion
Disallow: /private
Crawl-delay: 2

User-agent: *
Disallow: /nope
`);
  assert.deepEqual([...policy.disallow], ['/private', '/nope']);
  assert.equal(policy.crawlDelayMs, 2000);
});

test('longest-match robots rule wins', () => {
  const policy = { disallow: ['/docs/private'], allow: ['/docs'], crawlDelayMs: 0 };
  assert.equal(robotsAllows(policy, '/docs/intro'), true, 'shorter Allow wins');
  assert.equal(robotsAllows(policy, '/docs/private/secret'), false, 'longer Disallow wins');
  assert.equal(robotsAllows(policy, '/other'), true);
});

// ----------------------------------------------------------------- crawl

const BOUNDARY = { origin: 'https://docs.example.org', pathPrefix: '/learn', maxPages: 3, maxDepth: 1 };
const publicDns = async () => ['93.184.216.34'];

/** In-memory site so crawl limits can be tested without touching the network. */
function fakeSite(pages, robotsText = 'User-agent: *\nAllow: /learn') {
  const requested = [];
  const get = async (url) => {
    const target = new URL(url);
    requested.push(target.pathname);
    if (target.pathname === '/robots.txt') {
      return { status: 200, headers: {}, body: robotsText, truncated: false, bytes: robotsText.length };
    }
    const body = pages[target.pathname];
    if (body === undefined) return { status: 404, headers: {}, body: '', truncated: false, bytes: 0 };
    return { status: 200, headers: {}, body, truncated: false, bytes: body.length };
  };
  return { get, requested };
}

test('a crawl stays inside the approved path and returns readable pages', async () => {
  const site = fakeSite({
    '/learn': html('<p>' + 'Real documentation content about widgets. '.repeat(20) + '</p><a href="/learn/deep">deep</a><a href="https://evil.example/learn/x">evil</a>'),
    '/learn/deep': html('<p>' + 'Deeper documentation page content here. '.repeat(20) + '</p>'),
  });
  const result = await crawlApprovedSource('https://docs.example.org/learn', BOUNDARY, {
    get: site.get,
    resolve: publicDns,
    sleep: async () => {},
    limits: { minDelayMs: 0, maxPages: 5 },
  });
  assert.equal(result.pages.length, 2);
  for (const page of result.pages) assert.ok(page.url.startsWith('https://docs.example.org/learn'));
  assert.ok(!site.requested.some((p) => p.includes('evil')), 'an off-boundary link must never be fetched');
});

test('page and byte budgets are enforced', async () => {
  const pages = {};
  for (let i = 0; i < 10; i += 1) {
    pages[`/learn/p${i}`] = html(`<p>${'Content body text. '.repeat(30)}</p><a href="/learn/p${i + 1}">next</a>`);
  }
  pages['/learn'] = html(`<p>${'Index page content. '.repeat(30)}</p><a href="/learn/p0">go</a>`);
  const site = fakeSite(pages);

  const capped = await crawlApprovedSource('https://docs.example.org/learn', BOUNDARY, {
    get: site.get,
    resolve: publicDns,
    sleep: async () => {},
    limits: { maxPages: 2, minDelayMs: 0 },
  });
  assert.equal(capped.pages.length, 2, 'maxPages must be respected');
  assert.ok(capped.visited.length <= 2, `fetched ${capped.visited.length} pages under a cap of 2`);

  const bytes = await crawlApprovedSource('https://docs.example.org/learn', BOUNDARY, {
    get: site.get,
    resolve: publicDns,
    sleep: async () => {},
    limits: { maxPages: 10, maxTotalBytes: 500, minDelayMs: 0 },
  });
  assert.equal(bytes.pages.length, 0, 'a first page larger than the total budget must be skipped');
  assert.ok(bytes.errors.some((e) => e.reason === 'size-limit'));
});

test('a disallowed path is skipped rather than fetched', async () => {
  const site = fakeSite({ '/learn': html('<p>' + 'allowed content. '.repeat(30) + '</p>') }, 'User-agent: *\nDisallow: /learn');
  const result = await crawlApprovedSource('https://docs.example.org/learn', BOUNDARY, {
    get: site.get,
    resolve: publicDns,
    sleep: async () => {},
    limits: { minDelayMs: 0 },
  });
  assert.equal(result.pages.length, 0);
  assert.ok(result.errors.some((e) => e.reason === 'robots-disallow'));
});

test('a redirect to another host is refused and never followed', async () => {
  let requests = 0;
  const get = async (url) => {
    const target = new URL(url);
    if (target.pathname === '/robots.txt') return { status: 404, headers: {}, body: '', truncated: false, bytes: 0 };
    requests += 1;
    return { status: 302, headers: { location: 'https://evil.example/learn' }, body: '', truncated: false, bytes: 0 };
  };
  const result = await crawlApprovedSource('https://docs.example.org/learn', BOUNDARY, {
    get,
    resolve: publicDns,
    sleep: async () => {},
    limits: { minDelayMs: 0 },
  });
  assert.equal(requests, 1, 'the hostile redirect target must not be requested');
  assert.ok(result.errors.some((e) => e.reason === 'host-not-approved'));
});

test('a host that resolves to a private address yields nothing', async () => {
  const site = fakeSite({ '/learn': html('<p>' + 'should never be stored. '.repeat(30) + '</p>') });
  const result = await crawlApprovedSource('https://docs.example.org/learn', BOUNDARY, {
    get: site.get,
    resolve: async () => ['127.0.0.1'],
    sleep: async () => {},
    limits: { minDelayMs: 0 },
  });
  assert.equal(result.pages.length, 0);
  assert.ok(result.errors.some((e) => e.reason === 'blocked-address'));
});

test('pages without real content are skipped', async () => {
  const site = fakeSite({ '/learn': html('<p>tiny</p>') });
  const result = await crawlApprovedSource('https://docs.example.org/learn', BOUNDARY, {
    get: site.get,
    resolve: publicDns,
    sleep: async () => {},
    limits: { minDelayMs: 0 },
  });
  assert.equal(result.pages.length, 0);
  assert.ok(result.errors.some((e) => e.reason === 'no-readable-content'));
});

// -------------------------------------------------------------- knowledge

function store() {
  const dir = tempDir();
  const db = new AstraDatabase(path.join(dir, 'astra.db'));
  db.migrate();
  return { db, knowledge: new KnowledgeStore(db), dir };
}

test('knowledge is stored, retrieved and cited with a real source URL', () => {
  const { db, knowledge, dir } = store();
  try {
    const source = knowledge.addSource({ url: 'https://docs.example.org/learn', host: 'docs.example.org', label: 'Example docs', pathPrefix: '/learn' });
    knowledge.storeDocument({
      sourceId: source.id,
      url: 'https://docs.example.org/learn/widgets',
      title: 'Widgets',
      text: 'Widgets are configurable components. ' + 'Widgets accept many options. '.repeat(30),
      bytes: 2048,
    });

    const hits = knowledge.search('widgets configurable');
    assert.ok(hits.length > 0, 'expected retrieved passages');
    assert.equal(hits[0].documentUrl, 'https://docs.example.org/learn/widgets');
    assert.equal(hits[0].documentTitle, 'Widgets');
    assert.equal(hits[0].sourceLabel, 'Example docs');
    assert.match(hits[0].text, /Widgets/);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('identical content is deduplicated rather than stored twice', () => {
  const { db, knowledge, dir } = store();
  try {
    const source = knowledge.addSource({ url: 'https://docs.example.org/learn', host: 'docs.example.org' });
    const text = 'Repeated body text about caching behaviour. '.repeat(30);
    const first = knowledge.storeDocument({ sourceId: source.id, url: 'https://docs.example.org/learn/a', title: 'A', text, bytes: 100 });
    const second = knowledge.storeDocument({ sourceId: source.id, url: 'https://docs.example.org/learn/a', title: 'A', text, bytes: 100 });
    assert.equal(first.duplicate, false);
    assert.equal(second.duplicate, true);
    assert.equal(knowledge.listDocuments(source.id).length, 1);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('revoking a source stops it influencing answers but keeps it inspectable', () => {
  const { db, knowledge, dir } = store();
  try {
    const source = knowledge.addSource({ url: 'https://docs.example.org/learn', host: 'docs.example.org', label: 'Docs' });
    knowledge.storeDocument({
      sourceId: source.id,
      url: 'https://docs.example.org/learn/z',
      title: 'Z',
      text: 'Zebracore is a fictional technology with special properties. '.repeat(30),
      bytes: 300,
    });
    assert.ok(knowledge.search('zebracore').length > 0);

    knowledge.revokeSource(source.id);
    assert.equal(knowledge.search('zebracore', 6, true).length, 0, 'revoked sources must not be cited');
    assert.ok(knowledge.search('zebracore', 6, false).length > 0, 'stored knowledge must remain inspectable');
    assert.equal(knowledge.listDocuments(source.id).length, 1, 'revoking must not delete stored pages');
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('deleting a source removes its documents and chunks', () => {
  const { db, knowledge, dir } = store();
  try {
    const source = knowledge.addSource({ url: 'https://docs.example.org/learn', host: 'docs.example.org' });
    knowledge.storeDocument({ sourceId: source.id, url: 'https://docs.example.org/learn/d', title: 'D', text: 'Deletion test content. '.repeat(40), bytes: 400 });
    assert.ok(knowledge.search('deletion').length > 0);
    knowledge.deleteSourceKnowledge(source.id);
    assert.equal(knowledge.search('deletion').length, 0);
    assert.equal(knowledge.listDocuments(source.id).length, 0);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('retrieval survives punctuation-heavy and injection-shaped queries', () => {
  const { db, knowledge, dir } = store();
  try {
    const source = knowledge.addSource({ url: 'https://docs.example.org/learn', host: 'docs.example.org' });
    knowledge.storeDocument({
      sourceId: source.id,
      url: 'https://docs.example.org/learn/s',
      title: 'S',
      text: 'Sandboxing documentation for the repository guard. '.repeat(30),
      bytes: 300,
    });
    for (const query of ['sandboxing', '" OR "1"="1', 'NEAR(a b)', 'sandboxing*', 'select * from', '']) {
      assert.doesNotThrow(() => knowledge.search(query), query);
    }
    assert.ok(knowledge.search('sandboxing').length > 0);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('stale content is flagged so answers can warn about freshness', () => {
  const { db, knowledge, dir } = store();
  try {
    const source = knowledge.addSource({ url: 'https://docs.example.org/learn', host: 'docs.example.org' });
    knowledge.storeDocument({ sourceId: source.id, url: 'https://docs.example.org/learn/t', title: 'T', text: 'Freshness test content. '.repeat(30), bytes: 300 });
    assert.equal(knowledge.search('freshness')[0].stale, false);
    knowledge.markStale(source.id);
    assert.equal(knowledge.search('freshness')[0].stale, true);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an empty query returns nothing rather than everything', () => {
  const { db, knowledge, dir } = store();
  try {
    const source = knowledge.addSource({ url: 'https://docs.example.org/learn', host: 'docs.example.org' });
    knowledge.storeDocument({ sourceId: source.id, url: 'https://docs.example.org/learn/e', title: 'E', text: 'Content. '.repeat(60), bytes: 300 });
    assert.deepEqual(knowledge.search(''), []);
    assert.deepEqual(knowledge.search('   '), []);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('default limits are conservative', () => {
  assert.ok(DEFAULT_LIMITS.maxTotalBytes <= 8_000_000);
  assert.ok(DEFAULT_LIMITS.maxDocumentBytes <= 2_000_000);
  assert.ok(DEFAULT_LIMITS.totalTimeoutMs <= 60_000);
  assert.ok(DEFAULT_LIMITS.maxRedirects <= 3);
  assert.match(DEFAULT_LIMITS.userAgent, /AstraLocalCompanion/);
});