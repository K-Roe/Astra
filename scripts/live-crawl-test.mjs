/**
 * Proves the crawler works against a real public HTTPS site.
 * Requires internet access; reports honestly when offline.
 */
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { crawlApprovedSource } = require('../dist-electron/main/research/reader.js');
const { AstraDatabase } = require('../dist-electron/main/knowledge/database.js');
const { KnowledgeStore } = require('../dist-electron/main/knowledge/knowledgeStore.js');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');

const target = process.argv[2] ?? 'https://react.dev/learn';
const parsed = new URL(target);
const boundary = { origin: parsed.origin, pathPrefix: parsed.pathname, maxPages: 2, maxDepth: 0 };

const dir = mkdtempSync(path.join(tmpdir(), 'astra-live-'));
const db = new AstraDatabase(path.join(dir, 'astra.db'));
db.migrate();
const knowledge = new KnowledgeStore(db);

console.log(`Live crawl of ${target} (boundary: ${boundary.origin}${boundary.pathPrefix})`);
try {
  const source = knowledge.addSource({ url: parsed.origin + parsed.pathname, host: parsed.hostname, label: parsed.hostname, pathPrefix: parsed.pathname });
  const result = await crawlApprovedSource(target, boundary, { limits: { maxPages: 2, maxDepth: 0, totalTimeoutMs: 45000 } });
  console.log(`  visited: ${result.visited.length}, pages kept: ${result.pages.length}`);
  for (const page of result.pages) {
    knowledge.storeDocument({ sourceId: source.id, url: page.url, title: page.page.title, text: page.page.text, bytes: page.bytes });
    console.log(`  STORED  ${page.url}  (${page.page.text.length} chars)  "${page.page.title}"`);
  }
  for (const error of result.errors) console.log(`  skipped ${error.url}: ${error.reason}`);

  if (result.pages.length > 0) {
    const word = result.pages[0].page.text.split(/\s+/).find((w) => w.length > 7)?.replace(/[^a-z]/gi, '') ?? 'learn';
    const hits = knowledge.search(word, 3);
    console.log(`  search "${word}" -> ${hits.length} passage(s)`);
    if (hits[0]) console.log(`  citation: ${hits[0].documentUrl}`);
    mkdirSync('test-results/intelligence', { recursive: true });
    writeFileSync('test-results/intelligence/live-crawl.json', JSON.stringify({
      target, visited: result.visited, errors: result.errors,
      pages: result.pages.map((p) => ({ url: p.url, title: p.page.title, chars: p.page.text.length, bytes: p.bytes })),
      sampleHit: hits[0] ? { url: hits[0].documentUrl, text: hits[0].text.slice(0, 200) } : null,
    }, null, 2), 'utf8');
    console.log('  wrote test-results/intelligence/live-crawl.json');
    db.close(); rmSync(dir, { recursive: true, force: true });
    process.exit(0);
  }
  console.log('  NO PAGES STORED');
  db.close(); rmSync(dir, { recursive: true, force: true });
  process.exit(1);
} catch (error) {
  console.log(`  live crawl failed: ${error instanceof Error ? error.message : String(error)}`);
  console.log('  This indicates no network access or the host is not reachable/allowed.');
  db.close(); rmSync(dir, { recursive: true, force: true });
  process.exit(2);
}