import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const INSTALLER = resolve(HERE, '..', '..', '..', 'install.sh');

function makeHarness() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-installer-test-'));
  const repo = join(root, 'repo');
  const bin = join(root, 'bin');
  const log = join(root, 'npm.log');
  mkdirSync(bin, { recursive: true });
  for (const pkg of ['wechat', 'wallpaper', 'vision']) mkdirSync(join(repo, 'packages', pkg), { recursive: true });
  copyFileSync(INSTALLER, join(repo, 'install.sh'));

  const npm = join(bin, 'npm');
  writeFileSync(npm, `#!/usr/bin/env node
const { appendFileSync, mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const args = process.argv.slice(2);
appendFileSync(process.env.FAKE_NPM_LOG, args.join(' ') + '\\n');
if (args[0] === 'pack') {
  const destination = args[args.indexOf('--pack-destination') + 1];
  mkdirSync(destination, { recursive: true });
  const count = Number(process.env.FAKE_TGZ_COUNT || 1);
  for (let i = 0; i < count; i += 1) writeFileSync(join(destination, 'package-' + i + '.tgz'), 'tarball');
}
`);
  chmodSync(npm, 0o755);

  return { root, repo, bin, log };
}

function runInstaller(harness, args, extraEnv = {}) {
  return spawnSync('bash', [join(harness.repo, 'install.sh'), ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      ...extraEnv,
      PATH: `${harness.bin}:${process.env.PATH}`,
      HOME: join(harness.root, 'home'),
      TMPDIR: harness.root,
      FAKE_NPM_LOG: harness.log,
    },
  });
}

test('未知包在任何安装前清楚地以非零状态退出', () => {
  const harness = makeHarness();
  try {
    const result = runInstaller(harness, ['wallpaper', '不存在']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /未知功能包: 不存在/);
    assert.throws(() => readFileSync(harness.log), /ENOENT/);
  } finally {
    rmSync(harness.root, { recursive: true, force: true });
  }
});

test('选择性安装只总结实际选择并安装成功的包', () => {
  const harness = makeHarness();
  try {
    const result = runInstaller(harness, ['wallpaper']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /已安装 1 个功能包/);
    assert.match(result.stdout, /更换背景壁纸：命令已安装/);
    assert.doesNotMatch(result.stdout, /微信：/);
    assert.doesNotMatch(result.stdout, /识图：/);
    assert.match(readFileSync(harness.log, 'utf8'), /pack[\s\S]*install/);
  } finally {
    rmSync(harness.root, { recursive: true, force: true });
  }
});

test('tarball 数量异常会立即停止且不调用 npm install', () => {
  const harness = makeHarness();
  try {
    const result = runInstaller(harness, ['wallpaper'], { FAKE_TGZ_COUNT: '2' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /应只生成一个 tarball/);
    assert.doesNotMatch(readFileSync(harness.log, 'utf8'), /^install/m);
  } finally {
    rmSync(harness.root, { recursive: true, force: true });
  }
});
