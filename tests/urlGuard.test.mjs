import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  UrlRejected,
  assertFetchAllowed,
  followApprovedRedirects,
  isBlockedAddress,
  isBlockedIpv4,
  isBlockedIpv6,
  parseIpv4,
  parseIpv6,
} = require('../dist-electron/main/research/urlGuard.js');

const BOUNDARY = { origin: 'https://docs.example.org', pathPrefix: '/learn', maxPages: 5, maxDepth: 1 };
/** Always resolves to a public address unless a test says otherwise. */
const publicDns = async () => ['93.184.216.34'];

async function rejection(fn) {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected a UrlRejected');
}

test('IPv4 parsing is strict', () => {
  assert.equal(parseIpv4('192.168.1.1'), 0xc0a80101);
  assert.equal(parseIpv4('1.2.3'), null);
  assert.equal(parseIpv4('256.1.1.1'), null);
  assert.equal(parseIpv4('1.2.3.4.5'), null);
  assert.equal(parseIpv4('a.b.c.d'), null);
});

test('IPv6 parsing handles compression, uppercase and IPv4 suffixes', () => {
  // Returned as 16 bytes (two per hextet), so ::1 is the last byte pair.
  assert.equal(parseIpv6('::1').length, 16);
  assert.deepEqual(parseIpv6('::1').slice(-2), [0, 1]);
  assert.deepEqual(parseIpv6('::ffff:127.0.0.1').slice(12), [127, 0, 0, 1]);
  assert.deepEqual(parseIpv6('[fe80::1]').slice(0, 2), [0xfe, 0x80]);
  assert.equal(parseIpv6('1:2:3:4:5:6:7:8:9'), null);
  assert.equal(parseIpv6('1:2:3:4:5:6:7'), null);
  assert.equal(parseIpv6('not-an-ip'), null);
});

test('private, loopback, link-local and reserved IPv4 ranges are blocked', () => {
  for (const address of ['10.0.0.1', '172.16.0.1', '192.168.1.1', '127.0.0.1', '169.254.1.1', '100.64.0.1', '224.0.0.1', '0.0.0.0', '255.255.255.255']) {
    assert.equal(isBlockedIpv4(address), true, `${address} must be blocked`);
  }
  assert.equal(isBlockedIpv4('93.184.216.34'), false, 'a public address must be allowed');
  assert.equal(isBlockedIpv4('8.8.8.8'), false);
});

test('loopback, ULA, link-local and IPv4-mapped IPv6 are blocked', () => {
  for (const address of ['::1', '::', 'fe80::1', 'fc00::1', 'fd00::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:192.168.1.1', '64:ff9b::7f00:1']) {
    assert.equal(isBlockedIpv6(address), true, `${address} must be blocked`);
  }
  assert.equal(isBlockedIpv6('2606:2800:220:1:248:1893:25c8:1946'), false, 'a public IPv6 must be allowed');
});

test('a hostname that is not an IP literal is treated as unsafe', () => {
  assert.equal(isBlockedAddress('example.com'), true);
  assert.equal(isBlockedAddress('93.184.216.34'), false);
});

test('only the exact approved host is allowed', async () => {
  await assertFetchAllowed('https://docs.example.org/learn/intro', BOUNDARY, publicDns);
  for (const hostile of [
    'https://evil.com/learn',
    'https://docs.example.org.evil.com/learn',
    'https://sub.docs.example.org/learn',
    'https://DOCS.EXAMPLE.ORG.evil.test/learn',
    'http://docs.example.org/learn',
    'https://user:pass@docs.example.org/learn',
    'https://docs.example.org:8443/learn',
  ]) {
    const error = await rejection(() => assertFetchAllowed(hostile, BOUNDARY, publicDns));
    assert.ok(error instanceof UrlRejected, hostile);
  }
});

test('the crawl cannot escape the approved path prefix', async () => {
  await assertFetchAllowed('https://docs.example.org/learn', BOUNDARY, publicDns);
  await assertFetchAllowed('https://docs.example.org/learn/nested/page', BOUNDARY, publicDns);
  for (const escape of [
    'https://docs.example.org/',
    'https://docs.example.org/admin',
    'https://docs.example.org/learnings',
    'https://docs.example.org/learn/../admin',
  ]) {
    const error = await rejection(() => assertFetchAllowed(escape, BOUNDARY, publicDns));
    assert.ok(error instanceof UrlRejected, escape);
    assert.ok(['path-outside-boundary', 'host-not-approved'].includes(error.reason), escape);
  }
});

test('localhost, metadata and private DNS answers are refused', async () => {
  const cases = [
    ['localhost', async () => ['127.0.0.1'], 'local-hostname'],
    ['metadata.google.internal', async () => ['169.254.169.254'], 'local-hostname'],
    ['rebind.test', async () => ['93.184.216.34', '127.0.0.1'], 'blocked-address'],
    ['private.test', async () => ['10.0.0.5'], 'blocked-address'],
  ];
  for (const [host, resolve, reason] of cases) {
    const boundary = { ...BOUNDARY, origin: `https://${host}` };
    const url = `https://${host}/learn`;
    const error = await rejection(() => assertFetchAllowed(url, boundary, resolve));
    assert.equal(error.reason, reason, url);
  }
});

test('an IP literal host is checked directly without DNS', async () => {
  const error = await rejection(() => assertFetchAllowed('https://169.254.169.254/latest/meta-data/', BOUNDARY, publicDns));
  assert.equal(error.reason, 'host-not-approved');
});

test('DNS failure is reported rather than treated as allowed', async () => {
  const error = await rejection(() => assertFetchAllowed('https://docs.example.org/learn', BOUNDARY, async () => {
    throw new Error('ENOTFOUND');
  }));
  assert.equal(error.reason, 'dns-failed');
});

test('the validated address is returned so the connection can be pinned', async () => {
  const target = await assertFetchAllowed('https://docs.example.org/learn', BOUNDARY, async () => ['93.184.216.34', '93.184.216.35']);
  assert.equal(target.pinnedAddress, '93.184.216.34');
  assert.equal(target.url.pathname, '/learn');
});

test('redirects are re-validated and a cross-host redirect is refused', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.endsWith('/learn')) {
      return new Response(null, { status: 302, headers: { location: 'https://evil.com/learn' } });
    }
    return new Response('body', { status: 200 });
  };
  const error = await rejection(() => followApprovedRedirects('https://docs.example.org/learn', BOUNDARY, 3, fetchImpl, publicDns));
  assert.equal(error.reason, 'host-not-approved');
  assert.equal(calls.length, 1, 'the hostile redirect target must never be fetched');
});

test('redirect loops are bounded', async () => {
  const fetchImpl = async (url) => new Response(null, { status: 302, headers: { location: `${url}?again` } });
  const error = await rejection(() => followApprovedRedirects('https://docs.example.org/learn', BOUNDARY, 3, fetchImpl, publicDns));
  assert.equal(error.reason, 'too-many-redirects');
});

test('a same-host redirect chain is followed to its end', async () => {
  let n = 0;
  const fetchImpl = async () => {
    n += 1;
    return n < 3
      ? new Response(null, { status: 302, headers: { location: 'https://docs.example.org/learn/page' } })
      : new Response('done', { status: 200 });
  };
  const { response, finalUrl } = await followApprovedRedirects('https://docs.example.org/learn', BOUNDARY, 5, fetchImpl, publicDns);
  assert.equal(await response.text(), 'done');
  assert.equal(finalUrl, 'https://docs.example.org/learn/page');
});

test('a redirect that changes port or scheme is refused', async () => {
  for (const location of ['http://docs.example.org/learn', 'https://docs.example.org:8443/learn']) {
    const fetchImpl = async () => new Response(null, { status: 302, headers: { location } });
    const error = await rejection(() => followApprovedRedirects('https://docs.example.org/learn', BOUNDARY, 3, fetchImpl, publicDns));
    assert.ok(['not-https', 'non-standard-port'].includes(error.reason), location);
  }
});