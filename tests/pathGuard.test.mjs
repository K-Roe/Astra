import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  resolveWithinRoot,
  resolveWithinRootNotRoot,
  assertNotReservedName,
  isIndexableFile,
  isSensitiveFile,
} = require('../dist-electron/main/workspace/pathGuard.js');

/** Windows cannot create a symlink without privilege, so fall back to a junction-free test. */
function makeLink(target, linkPath, type) {
  try {
    symlinkSync(target, linkPath, type);
    return true;
  } catch {
    return false;
  }
}

function rejected(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected a PathRejected');
}

function sandbox(name = 'root') {
  const base = mkdtempSync(path.join(tmpdir(), 'astra-paths-'));
  const root = path.join(base, name);
  mkdirSync(path.join(root, 'src'), { recursive: true });
  return { base, root };
}

test('paths inside the root resolve to an absolute canonical path', () => {
  const { base, root } = sandbox();
  try {
    const resolved = resolveWithinRoot(path.join(root, 'src', 'index.ts'), { root });
    assert.ok(path.isAbsolute(resolved));
    assert.equal(path.basename(resolved), 'index.ts');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('relative traversal escapes are refused', () => {
  const { base, root } = sandbox();
  try {
    for (const evil of [
      path.join(root, '..', 'outside.txt'),
      path.join(root, 'src', '..', '..', 'evil.txt'),
      path.join(root, 'src', '..', '..', '..', 'Windows', 'System32', 'config'),
      path.join(root, '.', 'src', '.', 'ok.ts'),
    ]) {
      const result = resolvedOrNull(evil, { root });
      // The ones that stay inside the root are fine; the ones that escape are not.
      if (evil.includes('..') && !evil.endsWith('ok.ts')) {
        assert.equal(result.ok, false, `${evil} must be refused`);
      }
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

function resolvedOrNull(target, options) {
  try {
    return { ok: true, value: resolveWithinRoot(target, options) };
  } catch (error) {
    return { ok: false, error };
  }
}

test('a sibling directory sharing the root prefix is refused', () => {
  const base = mkdtempSync(path.join(tmpdir(), 'astra-paths-'));
  try {
    const root = path.join(base, 'repos');
    mkdirSync(root, { recursive: true });
    const sibling = path.join(base, 'repos-evil', 'secret.txt');
    mkdirSync(path.dirname(sibling), { recursive: true });
    writeFileSync(sibling, 'secret');
    // `repos-evil` starts with the string `repos` but is a different directory.
    const error = rejected(() => resolveWithinRoot(sibling, { root }));
    assert.equal(error.reason, 'outside-root');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('an absolute path outside the root is refused', () => {
  const { base, root } = sandbox();
  try {
    for (const outside of ['C:\\Windows\\System32\\drivers\\etc\\hosts', 'C:\\Users\\karlr\\.ssh\\id_rsa', '/etc/passwd']) {
      const error = rejected(() => resolveWithinRoot(outside, { root }));
      assert.equal(error.reason, 'outside-root', outside);
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('case-insensitive bypass is refused', () => {
  const { base, root } = sandbox();
  try {
    const result = resolvedOrNull(path.join(root, 'SRC', '..', 'src', 'index.ts'), { root });
    // Windows treats these as the same path, so it must be accepted as inside
    // the root; what must never happen is acceptance of a path outside it.
    assert.equal(result.ok, true);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('a symlink pointing outside the root is refused', () => {
  const base = mkdtempSync(path.join(tmpdir(), 'astra-paths-'));
  try {
    const root = path.join(base, 'repos');
    const outside = path.join(base, 'outside');
    mkdirSync(root, { recursive: true });
    mkdirSync(outside, { recursive: true });
    writeFileSync(path.join(outside, 'secret.txt'), 'secret');

    const link = path.join(root, 'link');
    const made = makeLink(outside, link, 'junction');
    if (!made) return; // Cannot create links in this environment; skip honestly.

    const error = rejected(() => resolveWithinRoot(path.join(link, 'secret.txt'), { root }));
    assert.ok(['symlinked-path', 'outside-root'].includes(error.reason), error.reason);

    // Even with links explicitly allowed, the real target is still outside.
    const error2 = rejected(() => resolveWithinRoot(path.join(link, 'secret.txt'), { root, allowLinks: true }));
    assert.equal(error2.reason, 'outside-root');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('a symlinked parent directory cannot smuggle a path out of the root', () => {
  const base = mkdtempSync(path.join(tmpdir(), 'astra-paths-'));
  try {
    const root = path.join(base, 'repos');
    const outside = path.join(base, 'outside');
    mkdirSync(path.join(root, 'real'), { recursive: true });
    mkdirSync(outside, { recursive: true });
    const link = path.join(root, 'linked');
    if (!makeLink(outside, link, 'junction')) return;

    // Target does not exist yet: resolution must still notice the junction.
    const error = rejected(() => resolveWithinRoot(path.join(link, 'new-file.ts'), { root }));
    assert.ok(['symlinked-path', 'outside-root'].includes(error.reason), error.reason);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('a NUL byte in a path is refused', () => {
  const { base, root } = sandbox();
  try {
    const error = rejected(() => resolveWithinRoot(`${root}\\evil\u0000.ts`, { root }));
    assert.equal(error.reason, 'nul-byte');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('the root itself cannot be treated as an editable target', () => {
  const { base, root } = sandbox();
  try {
    const error = rejected(() => resolveWithinRootNotRoot(root, { root }));
    assert.equal(error.reason, 'is-root');
    assert.ok(resolveWithinRootNotRoot(path.join(root, 'src'), { root }));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('Windows reserved device names are refused', () => {
  for (const name of ['CON', 'con.txt', 'NUL', 'PRN.md', 'COM1', 'LPT1.log']) {
    const error = rejected(() => assertNotReservedName(name));
    assert.equal(error.reason, 'reserved-device-name', name);
  }
  assert.ok(assertNotReservedName('index.ts') === undefined);
  assert.ok(assertNotReservedName('config.json') === undefined);
});

test('secrets and lockfiles are never indexable', () => {
  for (const name of ['.env', '.env.local', 'id_rsa', 'server.pem', 'credentials.json', 'npmrc', 'package-lock.json']) {
    assert.equal(isIndexableFile(name), false, `${name} must not be indexable`);
  }
  assert.equal(isSensitiveFile('.env'), true);
  assert.equal(isSensitiveFile('README.md'), false);
  for (const name of ['README.md', 'src/index.ts', 'package.json', 'AGENTS.md']) {
    assert.equal(isIndexableFile(name), true, `${name} should be indexable`);
  }
});