import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { deployLumaRuntime, NPM_CI_ARGS } from '../lib/install-runtime.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const VISION_DIR = join(HERE, '..');

function temporaryDirectory(t) {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-vision-install-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function writeRuntimeIdentity(directory, version = '1.0.0') {
  mkdirSync(join(directory, 'build'), { recursive: true });
  writeFileSync(join(directory, 'package.json'), JSON.stringify({
    name: 'luma-mcp',
    version,
    main: './build/index.js',
    scripts: { start: 'node build/index.js' },
  }));
  writeFileSync(join(directory, 'package-lock.json'), JSON.stringify({
    name: 'luma-mcp',
    version,
    lockfileVersion: 3,
    requires: true,
    packages: { '': { name: 'luma-mcp', version } },
  }));
  writeFileSync(join(directory, 'build', 'index.js'), 'export {}\n');
}

function makePrecompiledSource(root) {
  const source = join(root, 'source');
  writeRuntimeIdentity(source);
  return source;
}

test('precompiled luma metadata never invokes a missing source build', () => {
  const packageJson = JSON.parse(readFileSync(join(VISION_DIR, 'luma-mcp', 'package.json'), 'utf8'));
  assert.equal(packageJson.scripts.prepare, undefined);
  assert.equal(packageJson.scripts.build, undefined);
  assert.equal(packageJson.devDependencies, undefined);
  assert.ok(existsSync(join(VISION_DIR, 'luma-mcp', 'build', 'index.js')));
  assert.equal(packageJson.dependencies.sharp, '^0.35.3');
  assert.equal(packageJson.engines.node, '>=20.9.0');
});

test('deployment always uses npm ci and replaces an existing node_modules tree', (t) => {
  const root = temporaryDirectory(t);
  const source = makePrecompiledSource(root);
  const destination = join(root, 'runtime', 'package');
  writeRuntimeIdentity(destination, '0.9.0');
  mkdirSync(join(destination, 'node_modules'), { recursive: true });
  writeFileSync(join(destination, 'node_modules', 'stale.txt'), 'stale');
  const calls = [];

  deployLumaRuntime(source, destination, {
    run(command, args, options) {
      calls.push({ command, args, cwd: options.cwd });
      mkdirSync(join(options.cwd, 'node_modules'), { recursive: true });
      writeFileSync(join(options.cwd, 'node_modules', 'fresh.txt'), 'fresh');
    },
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0].command, /^npm(?:\.cmd)?$/);
  assert.deepEqual(calls[0].args, [...NPM_CI_ARGS]);
  assert.equal(existsSync(join(destination, 'node_modules', 'stale.txt')), false);
  assert.equal(readFileSync(join(destination, 'node_modules', 'fresh.txt'), 'utf8'), 'fresh');
  assert.equal(readdirSync(join(root, 'runtime')).some((name) => name.startsWith('.luma-mcp-')), false);
});

test('failed clean dependency install preserves the previous runtime', (t) => {
  const root = temporaryDirectory(t);
  const source = makePrecompiledSource(root);
  const destination = join(root, 'runtime', 'package');
  writeRuntimeIdentity(destination, '0.9.0');
  writeFileSync(join(destination, 'working.txt'), 'previous');

  assert.throws(() => deployLumaRuntime(source, destination, {
    run() {
      throw new Error('fixture npm failure');
    },
  }), /fixture npm failure/);

  assert.equal(readFileSync(join(destination, 'working.txt'), 'utf8'), 'previous');
  assert.equal(readdirSync(join(root, 'runtime')).some((name) => name.startsWith('.luma-mcp-')), false);
});

test('empty and nonexistent destinations remain valid deployment targets', (t) => {
  const root = temporaryDirectory(t);
  const source = makePrecompiledSource(root);
  const emptyDestination = join(root, 'empty-runtime');
  const missingDestination = join(root, 'new-parent', 'new-runtime');
  mkdirSync(emptyDestination);

  for (const destination of [emptyDestination, missingDestination]) {
    deployLumaRuntime(source, destination, {
      run(_command, _args, options) {
        mkdirSync(join(options.cwd, 'node_modules'));
      },
    });
    assert.equal(JSON.parse(readFileSync(join(destination, 'package.json'), 'utf8')).name, 'luma-mcp');
    assert.ok(existsSync(join(destination, 'build', 'index.js')));
  }
});

test('non-empty valuable documents are rejected before staging or npm and remain byte-for-byte intact', (t) => {
  const root = temporaryDirectory(t);
  const source = makePrecompiledSource(root);
  const destination = join(root, 'valuable-documents');
  mkdirSync(destination);
  const document = join(destination, 'irreplaceable.txt');
  writeFileSync(document, 'must survive\n', { mode: 0o640 });
  const beforeRoot = readdirSync(root).sort();
  const beforeDestination = readdirSync(destination).sort();
  let npmCalls = 0;

  assert.throws(
    () => deployLumaRuntime(source, destination, { run() { npmCalls += 1; } }),
    /not a verified luma-mcp runtime/,
  );

  assert.equal(npmCalls, 0);
  assert.equal(readFileSync(document, 'utf8'), 'must survive\n');
  assert.equal(statSync(document).mode & 0o777, 0o640);
  assert.deepEqual(readdirSync(destination).sort(), beforeDestination);
  assert.deepEqual(readdirSync(root).sort(), beforeRoot);
});

test('source overlap through direct and symlinked ancestors fails before any write', (t) => {
  const root = temporaryDirectory(t);
  const source = makePrecompiledSource(root);
  const sourceManifest = readFileSync(join(source, 'package.json'), 'utf8');
  const alias = join(root, 'source-alias');
  symlinkSync(source, alias, 'dir');
  const beforeRoot = readdirSync(root).sort();
  let npmCalls = 0;

  assert.throws(
    () => deployLumaRuntime(source, source, { run() { npmCalls += 1; } }),
    /source and destination must not overlap/,
  );
  assert.throws(
    () => deployLumaRuntime(source, join(alias, 'nested-runtime'), { run() { npmCalls += 1; } }),
    /source and destination must not overlap/,
  );

  assert.equal(npmCalls, 0);
  assert.equal(readFileSync(join(source, 'package.json'), 'utf8'), sourceManifest);
  assert.equal(existsSync(join(source, 'nested-runtime')), false);
  assert.deepEqual(readdirSync(root).sort(), beforeRoot);
});

test('filesystem root and HOME are rejected before staging', (t) => {
  const root = temporaryDirectory(t);
  const source = makePrecompiledSource(root);
  const fakeHome = join(root, 'fake-home');
  mkdirSync(fakeHome);
  let npmCalls = 0;

  assert.throws(
    () => deployLumaRuntime(source, '/', { run() { npmCalls += 1; }, homeDirectory: fakeHome }),
    /filesystem root/,
  );
  assert.throws(
    () => deployLumaRuntime(source, fakeHome, { run() { npmCalls += 1; }, homeDirectory: fakeHome }),
    /HOME or one of its ancestors/,
  );

  assert.equal(npmCalls, 0);
  assert.deepEqual(readdirSync(fakeHome), []);
  assert.equal(readdirSync(root).some((name) => name.startsWith('.luma-mcp-')), false);
});

test('published tarball contains every runtime helper imported by install.mjs', () => {
  const output = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: VISION_DIR,
    encoding: 'utf8',
  });
  const [{ files }] = JSON.parse(output);
  const paths = new Set(files.map(({ path }) => path));
  assert.ok(paths.has('install.mjs'));
  assert.ok(paths.has('lib/install-runtime.mjs'));
  assert.ok(paths.has('lib/patch-engine.mjs'));
  assert.equal([...paths].some((path) => path.startsWith('luma-mcp/node_modules/')), false);
});
