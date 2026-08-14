import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { applyWallpaperState, atomicWriteFile, buildCss, parseOpacity } from '../wallpaper.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(HERE, '..', 'wallpaper.mjs');

function makeFakeSips(root) {
  const bin = join(root, 'bin');
  mkdirSync(bin, { recursive: true });
  const command = join(bin, 'sips');
  writeFileSync(command, `#!/usr/bin/env node
const { writeFileSync } = require('node:fs');
const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
if (outIndex === -1 || !args[outIndex + 1]) process.exit(2);
writeFileSync(args[outIndex + 1], Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
`);
  chmodSync(command, 0o755);
  return bin;
}

function makeFakeBundle(home, cacheName = 'test-cache') {
  const bundle = join(home, '.npm', '_npx', cacheName, 'node_modules', '@deepseek-ai', 'dsh-client-ui-theme', 'lib', 'client.js');
  mkdirSync(dirname(bundle), { recursive: true });
  writeFileSync(bundle, 'function theme() {\n\t\treturn module.exports;\n}\n');
  return bundle;
}

function configPath(home) {
  return join(home, '.dsh-plugins', 'wallpaper', 'config.json');
}

function runCli(home, args, options = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: options.cwd ?? HERE,
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: home,
      PATH: options.path ?? process.env.PATH,
      DSH_NPX_RUNTIME_DIR: options.runtimeDir ?? '',
    },
  });
}

test('路径参数作为单一 argv 传给 sips，恶意文件名不会执行命令，临时目录会清理', { concurrency: false }, () => {
  const root = mkdtempSync(join(tmpdir(), 'wallpaper-injection-test-'));
  const previousCwd = process.cwd();
  const previousPath = process.env.PATH;
  try {
    const fakeBin = makeFakeSips(root);
    const tempParent = join(root, 'tmp');
    mkdirSync(tempParent);
    process.chdir(root);
    process.env.PATH = `${fakeBin}:${previousPath}`;

    const maliciousName = 'photo"; touch PWNED; #.png';
    writeFileSync(maliciousName, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const css = buildCss(maliciousName, 0.37, { osPlatform: 'darwin', tempParent });

    assert.match(css, /opacity:0\.37/);
    assert.equal(readdirSync(tempParent).length, 0);
    assert.throws(() => readFileSync(join(root, 'PWNED')), /ENOENT/);
  } finally {
    process.chdir(previousCwd);
    process.env.PATH = previousPath;
    rmSync(root, { recursive: true, force: true });
  }
});

test('合法图片路径与 opacity 通过 CLI 保持原有行为', () => {
  const root = mkdtempSync(join(tmpdir(), 'wallpaper-cli-test-'));
  try {
    const home = join(root, 'home');
    const fakeBin = makeFakeSips(root);
    const bundle = makeFakeBundle(home);
    const image = join(root, 'valid image.png');
    writeFileSync(image, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const result = runCli(home, ['set', image, '--opacity', '0.42'], { path: `${fakeBin}:${process.env.PATH}` });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /透明度 0\.42/);
    assert.equal(JSON.parse(readFileSync(join(home, '.dsh-plugins', 'wallpaper', 'config.json'), 'utf8')).opacity, 0.42);
    assert.match(readFileSync(bundle, 'utf8'), /opacity:0\.42/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('多个 npx 主题缓存时失败关闭且不按 mtime 猜测', () => {
  const root = mkdtempSync(join(tmpdir(), 'wallpaper-multiple-cache-test-'));
  try {
    const home = join(root, 'home');
    const older = makeFakeBundle(home, 'active-older');
    const newer = makeFakeBundle(home, 'inactive-newer');
    const original = readFileSync(older, 'utf8');
    utimesSync(older, new Date('2026-01-01T00:00:00Z'), new Date('2026-01-01T00:00:00Z'));
    utimesSync(newer, new Date('2026-02-01T00:00:00Z'), new Date('2026-02-01T00:00:00Z'));
    const image = join(root, 'valid.png');
    writeFileSync(image, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const result = runCli(home, ['set', image]);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /发现多个 DSH 主题 bundle/);
    assert.match(result.stderr, /DSH_NPX_RUNTIME_DIR/);
    assert.equal(readFileSync(older, 'utf8'), original);
    assert.equal(readFileSync(newer, 'utf8'), original);
    assert.equal(existsSync(configPath(home)), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('DSH_NPX_RUNTIME_DIR 显式选择唯一运行时并保持其他缓存不变', () => {
  const root = mkdtempSync(join(tmpdir(), 'wallpaper-explicit-cache-test-'));
  try {
    const home = join(root, 'home');
    const selectedRuntime = join(home, '.npm', '_npx', 'selected');
    const selected = makeFakeBundle(home, 'selected');
    const other = makeFakeBundle(home, 'other');
    const otherOriginal = readFileSync(other, 'utf8');
    const image = join(root, 'valid.png');
    writeFileSync(image, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const result = runCli(home, ['set', image], { runtimeDir: selectedRuntime });

    assert.equal(result.status, 0, result.stderr);
    assert.match(readFileSync(selected, 'utf8'), /DSH_WALLPAPER_MARKER_START/);
    assert.equal(readFileSync(other, 'utf8'), otherOriginal);
    assert.equal(JSON.parse(readFileSync(configPath(home), 'utf8')).source, image);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('非数字 opacity 显式失败且不写配置', () => {
  const root = mkdtempSync(join(tmpdir(), 'wallpaper-opacity-test-'));
  try {
    const home = join(root, 'home');
    const image = join(root, 'valid.png');
    writeFileSync(image, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const result = runCli(home, ['set', image, '--opacity', 'not-a-number']);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /透明度必须是/);
    assert.throws(() => readFileSync(join(home, '.dsh-plugins', 'wallpaper', 'config.json')), /ENOENT/);
    assert.throws(() => parseOpacity(Number.NaN), /透明度必须是/);
    assert.throws(() => parseOpacity(null), /透明度必须是/);

    const missingValueResult = runCli(home, ['set', image, '--opacity']);
    assert.equal(missingValueResult.status, 1);
    assert.match(missingValueResult.stderr, /透明度必须是/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('目录与非普通文件路径安全失败', () => {
  const root = mkdtempSync(join(tmpdir(), 'wallpaper-filetype-test-'));
  try {
    const home = join(root, 'home');
    const directoryResult = runCli(home, ['set', root]);
    const deviceResult = runCli(home, ['set', '/dev/null']);

    assert.equal(directoryResult.status, 1);
    assert.match(directoryResult.stderr, /普通图片文件/);
    assert.equal(deviceResult.status, 1);
    assert.match(deviceResult.stderr, /普通图片文件/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('bundle 不存在时 set 非零退出且不保存配置', () => {
  const root = mkdtempSync(join(tmpdir(), 'wallpaper-missing-bundle-test-'));
  try {
    const home = join(root, 'home');
    const image = join(root, 'valid.png');
    writeFileSync(image, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const result = runCli(home, ['set', image]);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /未找到 DSH 主题 bundle/);
    assert.throws(() => readFileSync(configPath(home)), /ENOENT/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('bundle 不存在时 off 非零退出且保留原配置', () => {
  const root = mkdtempSync(join(tmpdir(), 'wallpaper-off-failure-test-'));
  try {
    const home = join(root, 'home');
    const config = configPath(home);
    const original = { source: 'preset:aurora', opacity: 0.4 };
    mkdirSync(dirname(config), { recursive: true });
    writeFileSync(config, JSON.stringify(original));

    const result = runCli(home, ['off']);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /未找到 DSH 主题 bundle/);
    assert.deepEqual(JSON.parse(readFileSync(config, 'utf8')), original);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('首次 apply 遇到未知 bundle 结构时非零退出且不保存默认配置', () => {
  const root = mkdtempSync(join(tmpdir(), 'wallpaper-anchor-failure-test-'));
  try {
    const home = join(root, 'home');
    const bundle = makeFakeBundle(home);
    const original = 'function changedTheme() { return null; }\n';
    writeFileSync(bundle, original);

    const result = runCli(home, ['apply']);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /找不到注入点/);
    assert.throws(() => readFileSync(configPath(home)), /ENOENT/);
    assert.equal(readFileSync(bundle, 'utf8'), original);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('配置无法 stage 时 set 不修改 bundle', () => {
  const root = mkdtempSync(join(tmpdir(), 'wallpaper-config-stage-failure-test-'));
  try {
    const home = join(root, 'home');
    const bundle = makeFakeBundle(home);
    const original = readFileSync(bundle, 'utf8');
    mkdirSync(join(home, '.dsh-plugins'), { recursive: true });
    writeFileSync(join(home, '.dsh-plugins', 'wallpaper'), 'not a directory');
    const image = join(root, 'valid.png');
    writeFileSync(image, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const result = runCli(home, ['set', image]);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /写入 bundle\/config 失败/);
    assert.equal(readFileSync(bundle, 'utf8'), original);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('配置 commit 失败时回滚已提交的 bundle 并清理事务文件', () => {
  const root = mkdtempSync(join(tmpdir(), 'wallpaper-config-commit-failure-test-'));
  try {
    const bundle = join(root, 'client.js');
    const config = join(root, 'config.json');
    const originalBundle = 'function theme() {\n\t\treturn module.exports;\n}\n';
    const originalConfig = JSON.stringify({ source: null, opacity: 0.3 });
    writeFileSync(bundle, originalBundle);
    writeFileSync(config, originalConfig);

    const applied = applyWallpaperState('body::before{opacity:0.5}', { source: 'next.png', opacity: 0.5 }, {
      bundleTarget: bundle,
      configFile: config,
      transactionOptions: {
        beforeCommit(index) {
          if (index === 1) throw new Error('injected config commit failure');
        },
      },
    });

    assert.equal(applied, false);
    assert.equal(readFileSync(bundle, 'utf8'), originalBundle);
    assert.equal(readFileSync(config, 'utf8'), originalConfig);
    assert.deepEqual(readdirSync(root).sort(), ['client.js', 'config.json']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('原子替换失败时保留原 bundle 并清理同目录临时文件', () => {
  const root = mkdtempSync(join(tmpdir(), 'wallpaper-atomic-write-test-'));
  try {
    const target = join(root, 'client.js');
    writeFileSync(target, 'original bundle');

    assert.throws(
      () => atomicWriteFile(target, 'replacement bundle', {
        renameFile() { throw new Error('injected rename failure'); },
      }),
      /injected rename failure/,
    );
    assert.equal(readFileSync(target, 'utf8'), 'original bundle');
    assert.deepEqual(readdirSync(root), ['client.js']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
