import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  commitPatchFiles,
  PatchPlanError,
  planPatchFiles,
  resolveNpxRuntime,
} from '../lib/patch-engine.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const APPLY_PATCHES = join(HERE, '..', 'apply-patches.mjs');

function temporaryDirectory(t) {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-vision-patches-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function makeRuntime(root, name, version, timestamp) {
  const runtime = join(root, name);
  const scope = join(runtime, 'node_modules', '@deepseek-ai');
  for (const packageName of ['dsh', 'dsh-llm-deepseek', 'dsh-host-apiproxy']) {
    const packageDirectory = join(scope, packageName);
    mkdirSync(join(packageDirectory, 'lib'), { recursive: true });
    const packageFile = join(packageDirectory, 'package.json');
    writeFileSync(packageFile, JSON.stringify({ name: `@deepseek-ai/${packageName}`, version }));
    if (packageName !== 'dsh') writeFileSync(join(packageDirectory, 'lib', 'index.js'), 'export {}\n');
    utimesSync(packageFile, timestamp, timestamp);
  }
  utimesSync(runtime, timestamp, timestamp);
  return runtime;
}

test('cache discovery automatically selects the only complete runtime', (t) => {
  const root = temporaryDirectory(t);
  const runtime = makeRuntime(root, 'only', '0.1.0-rc.6', new Date('2026-01-01T00:00:00Z'));
  assert.equal(resolveNpxRuntime({ root }).runtimeRoot, runtime);
});

test('multiple complete caches fail closed regardless of mtime and list explicit choices', (t) => {
  const root = temporaryDirectory(t);
  const older = makeRuntime(root, 'older', '0.1.0-rc.6', new Date('2026-01-01T00:00:00Z'));
  const newer = makeRuntime(root, 'newer', '0.1.0-rc.6', new Date('2026-02-01T00:00:00Z'));
  const olderTarget = join(older, 'node_modules', '@deepseek-ai', 'dsh-llm-deepseek', 'lib', 'index.js');
  const newerTarget = join(newer, 'node_modules', '@deepseek-ai', 'dsh-llm-deepseek', 'lib', 'index.js');

  assert.throws(() => resolveNpxRuntime({ root }), (error) => {
    assert.match(error.message, /发现多个完整的 DSH npm-exec 运行时/);
    assert.match(error.message, /DSH_NPX_RUNTIME_DIR/);
    assert.ok(error.message.includes(older));
    assert.ok(error.message.includes(newer));
    assert.match(error.message, /未写入任何文件/);
    return true;
  });

  assert.equal(readFileSync(olderTarget, 'utf8'), 'export {}\n');
  assert.equal(readFileSync(newerTarget, 'utf8'), 'export {}\n');
  assert.equal(resolveNpxRuntime({ root, explicit: older }).runtimeRoot, older);
  assert.equal(resolveNpxRuntime({ root, explicit: newer }).runtimeRoot, newer);
});

test('apply CLI reports ambiguous caches and exits before touching any patch target', (t) => {
  const root = temporaryDirectory(t);
  const first = makeRuntime(root, 'first', '0.1.0-rc.6', new Date('2026-01-01T00:00:00Z'));
  const second = makeRuntime(root, 'second', '0.1.0-rc.6', new Date('2026-02-01T00:00:00Z'));
  const luma = join(root, 'luma', 'build');
  mkdirSync(luma, { recursive: true });
  const lumaTarget = join(luma, 'image-processor.js');
  writeFileSync(lumaTarget, 'luma-original\n');

  const result = spawnSync(process.execPath, [APPLY_PATCHES], {
    env: {
      ...process.env,
      DSH_NPX_ROOT: root,
      DSH_NPX_RUNTIME_DIR: '',
      DSH_VISION_LUMA_DIR: join(root, 'luma'),
    },
    encoding: 'utf8',
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /运行时选择失败：发现多个完整的 DSH npm-exec 运行时/);
  assert.ok(result.stderr.includes(first));
  assert.ok(result.stderr.includes(second));
  assert.match(result.stderr, /DSH_NPX_RUNTIME_DIR/);
  assert.equal(readFileSync(lumaTarget, 'utf8'), 'luma-original\n');
  for (const runtime of [first, second]) {
    const target = join(runtime, 'node_modules', '@deepseek-ai', 'dsh-llm-deepseek', 'lib', 'index.js');
    assert.equal(readFileSync(target, 'utf8'), 'export {}\n');
  }
});

test('a unique or explicitly selected unknown DSH version fails closed', (t) => {
  const root = temporaryDirectory(t);
  const unknown = makeRuntime(root, 'unknown', '0.2.0', new Date('2026-02-01T00:00:00Z'));
  assert.throws(() => resolveNpxRuntime({ root }), /不支持的 DSH 运行时版本 0\.2\.0/);
  assert.throws(() => resolveNpxRuntime({ root, explicit: unknown }), /不支持的 DSH 运行时版本 0\.2\.0/);
});

test('a later validation failure leaves every earlier target untouched', (t) => {
  const root = temporaryDirectory(t);
  const first = join(root, 'first.js');
  const second = join(root, 'second.js');
  writeFileSync(first, 'const value = "old";\n');
  writeFileSync(second, 'const changedUpstream = true;\n');

  assert.throws(() => planPatchFiles([
    {
      path: first,
      patches: [{ label: 'first', oldText: '"old"', newText: '"new"', marker: '"new"' }],
    },
    {
      path: second,
      patches: [{ label: 'second', oldText: 'missing anchor', newText: 'replacement', marker: 'replacement' }],
    },
  ]), PatchPlanError);

  assert.equal(readFileSync(first, 'utf8'), 'const value = "old";\n');
  assert.equal(readFileSync(second, 'utf8'), 'const changedUpstream = true;\n');
});

test('commit failure rolls back files already swapped and removes staging files', (t) => {
  const root = temporaryDirectory(t);
  const first = join(root, 'first.js');
  const second = join(root, 'second.js');
  writeFileSync(first, 'first-old');
  writeFileSync(second, 'second-old');

  assert.throws(() => commitPatchFiles([
    { path: first, original: 'first-old', content: 'first-new' },
    { path: second, original: 'second-old', content: 'second-new' },
  ], {
    beforeCommit(index) {
      if (index === 1) throw new Error('fixture commit failure');
    },
  }), /fixture commit failure/);

  assert.equal(readFileSync(first, 'utf8'), 'first-old');
  assert.equal(readFileSync(second, 'utf8'), 'second-old');
  assert.deepEqual(readdirSync(root).sort(), ['first.js', 'second.js']);
});

test('staging write failure closes and removes its temporary file', (t) => {
  const root = temporaryDirectory(t);
  const target = join(root, 'target.js');
  writeFileSync(target, 'old');

  assert.throws(() => commitPatchFiles([
    { path: target, original: 'old', content: Symbol('invalid write payload') },
  ]), /data|argument|type/i);

  assert.equal(readFileSync(target, 'utf8'), 'old');
  assert.deepEqual(readdirSync(root), ['target.js']);
});
