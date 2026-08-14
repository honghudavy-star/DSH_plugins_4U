import {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

export const SUPPORTED_DSH_VERSIONS = Object.freeze(['0.1.0-rc.6']);

const REQUIRED_PACKAGES = Object.freeze([
  '@deepseek-ai/dsh',
  '@deepseek-ai/dsh-llm-deepseek',
  '@deepseek-ai/dsh-host-apiproxy',
]);

function packageDirectory(scopeDir, packageName) {
  return join(scopeDir, packageName.slice('@deepseek-ai/'.length));
}

function readPackage(scopeDir, packageName) {
  const packageFile = join(packageDirectory(scopeDir, packageName), 'package.json');
  if (!existsSync(packageFile)) return null;
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(packageFile, 'utf8'));
  } catch (error) {
    throw new Error(`无法读取运行时清单 ${packageFile}: ${error.message}`);
  }
  if (manifest.name !== packageName || typeof manifest.version !== 'string') {
    throw new Error(`运行时清单目标不匹配: ${packageFile}`);
  }
  return { packageFile, manifest };
}

function scopeCandidates(input) {
  const absolute = resolve(input);
  const candidates = [
    absolute,
    join(absolute, '@deepseek-ai'),
    join(absolute, 'node_modules', '@deepseek-ai'),
  ];
  if (basename(absolute) === 'node_modules') {
    candidates.unshift(join(absolute, '@deepseek-ai'));
  }
  return [...new Set(candidates)];
}

function inspectRuntime(input) {
  for (const scopeDir of scopeCandidates(input)) {
    const packages = new Map();
    let complete = true;
    for (const packageName of REQUIRED_PACKAGES) {
      const pkg = readPackage(scopeDir, packageName);
      if (!pkg) {
        complete = false;
        break;
      }
      packages.set(packageName, pkg);
    }
    if (!complete) continue;

    const versions = new Set([...packages.values()].map(({ manifest }) => manifest.version));
    if (versions.size !== 1) {
      throw new Error(`DSH 运行时包版本不一致: ${scopeDir}`);
    }
    const version = [...versions][0];
    const runtimeRoot = dirname(dirname(scopeDir));
    return { runtimeRoot, scopeDir, version, packages };
  }
  return null;
}

function validateSupportedRuntime(runtime, supportedVersions) {
  if (!supportedVersions.includes(runtime.version)) {
    throw new Error(
      `不支持的 DSH 运行时版本 ${runtime.version}（已验证版本: ${supportedVersions.join(', ')}）；` +
      '为避免修改未知代码，已停止且未写入任何文件。',
    );
  }

  const targets = [
    ['@deepseek-ai/dsh-llm-deepseek', join('lib', 'index.js')],
    ['@deepseek-ai/dsh-host-apiproxy', join('lib', 'index.js')],
  ];
  for (const [packageName, relativeFile] of targets) {
    const target = join(packageDirectory(runtime.scopeDir, packageName), relativeFile);
    if (!existsSync(target)) throw new Error(`运行时补丁目标不存在: ${target}`);
  }
  return runtime;
}

/**
 * Resolve one complete npm-exec DSH runtime. An explicit path wins; otherwise
 * automatic selection is allowed only when exactly one complete runtime exists.
 * Cache timestamps cannot prove which runtime is active or will launch next.
 */
export function resolveNpxRuntime({ explicit, root, supportedVersions = SUPPORTED_DSH_VERSIONS } = {}) {
  if (explicit) {
    const runtime = inspectRuntime(explicit);
    if (!runtime) throw new Error(`DSH_NPX_RUNTIME_DIR 不是完整的 DSH npm-exec 运行时: ${explicit}`);
    return validateSupportedRuntime(runtime, supportedVersions);
  }

  if (!root || !existsSync(root)) throw new Error(`npx 缓存目录不存在: ${root ?? '(未设置)'}`);
  const candidates = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const runtime = inspectRuntime(join(root, entry.name));
    if (runtime) candidates.push(runtime);
  }
  if (candidates.length === 0) throw new Error(`未在 npx 缓存中找到完整的 @deepseek-ai/dsh 运行时: ${root}`);
  if (candidates.length > 1) {
    candidates.sort((a, b) => a.runtimeRoot.localeCompare(b.runtimeRoot));
    const choices = candidates.map((candidate) => `  - ${candidate.runtimeRoot} (${candidate.version})`).join('\n');
    throw new Error(
      `发现多个完整的 DSH npm-exec 运行时，无法安全判断实际目标：\n${choices}\n` +
      '请设置 DSH_NPX_RUNTIME_DIR 显式指定其中一个；已停止且未写入任何文件。',
    );
  }
  return validateSupportedRuntime(candidates[0], supportedVersions);
}

function occurrenceCount(value, needle) {
  if (!needle) return 0;
  let count = 0;
  let offset = 0;
  while ((offset = value.indexOf(needle, offset)) !== -1) {
    count += 1;
    offset += needle.length;
  }
  return count;
}

export class PatchPlanError extends Error {
  constructor(message, results) {
    super(message);
    this.name = 'PatchPlanError';
    this.results = results;
  }
}

/** Validate every target and calculate every replacement without writing. */
export function planPatchFiles(fileSpecs) {
  const results = [];
  const writes = [];
  const failures = [];

  for (const spec of fileSpecs) {
    if (!spec.path || !existsSync(spec.path)) {
      const message = `✗ ${spec.label ?? '补丁目标'}: 文件不存在 ${spec.path ?? '(空路径)'}`;
      results.push(message);
      failures.push(message);
      continue;
    }

    const original = readFileSync(spec.path, 'utf8');
    let content = original;
    for (const patch of spec.patches) {
      if (patch.marker && content.includes(patch.marker)) {
        results.push(`· ${patch.label}: 已打过（跳过）`);
        continue;
      }
      const count = occurrenceCount(content, patch.oldText);
      if (count !== 1) {
        const message = `✗ ${patch.label}: 替换目标出现 ${count} 次（预期 1 次），目标版本可能已变化`;
        results.push(message);
        failures.push(message);
        continue;
      }
      content = content.replace(patch.oldText, patch.newText);
      results.push(`✓ ${patch.label}: 已规划`);
    }
    if (content !== original) writes.push({ path: spec.path, original, content });
  }

  if (failures.length > 0) {
    throw new PatchPlanError(`${failures.length} 项补丁验证失败；未写入任何文件。`, results);
  }
  return { results, writes };
}

function stageWrite(write) {
  const mode = statSync(write.path).mode & 0o777;
  const temp = join(dirname(write.path), `.${basename(write.path)}.dsh-stage-${randomUUID()}`);
  const backup = `${temp}.backup`;
  const fd = openSync(temp, 'wx', mode);
  let failure;
  try {
    writeFileSync(fd, write.content, 'utf8');
    fsyncSync(fd);
  } catch (error) {
    failure = error;
  } finally {
    closeSync(fd);
  }
  if (failure) {
    removeIfPresent(temp);
    throw failure;
  }
  try {
    copyFileSync(write.path, backup);
  } catch (error) {
    removeIfPresent(temp);
    removeIfPresent(backup);
    throw error;
  }
  return { ...write, temp, backup };
}

function removeIfPresent(path) {
  try {
    rmSync(path, { force: true });
  } catch {
    // Cleanup must not hide the original transaction outcome.
  }
}

/**
 * Atomically replace each file and roll back already-swapped files if any later
 * commit fails. beforeCommit is a test hook used to exercise rollback.
 */
export function commitPatchFiles(writes, { beforeCommit } = {}) {
  if (writes.length === 0) return;
  const staged = [];
  const committed = [];
  try {
    for (const write of writes) staged.push(stageWrite(write));
    for (let index = 0; index < staged.length; index += 1) {
      const item = staged[index];
      beforeCommit?.(index, item);
      // temp 与目标同目录；rename 在支持的平台上以一次原子替换完成。
      renameSync(item.temp, item.path);
      committed.push(item);
    }
  } catch (error) {
    const rollbackErrors = [];
    for (const item of [...committed].reverse()) {
      try {
        // backup 同样与目标同目录，回滚也使用原子替换。
        renameSync(item.backup, item.path);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    for (const item of staged) {
      removeIfPresent(item.temp);
      if (!committed.includes(item)) removeIfPresent(item.backup);
    }
    if (rollbackErrors.length > 0) {
      throw new AggregateError([error, ...rollbackErrors], '补丁提交失败，且回滚未完全成功');
    }
    throw error;
  }

  for (const item of committed) removeIfPresent(item.backup);
}
