#!/usr/bin/env node
// install.mjs — 部署「微信」功能包（@dsh-plugins/wechat）
// 幂等：① 部署聊天服务（拷贝源码→装依赖→生成 plist→启动 launchd）② 打首页微信入口 UI 补丁。
//
// 环境变量:
//   DSH_PLUGINS_RUNTIME_DIR  运行时安装目录（默认 $HOME/DSH/plugins/self-built/dsh-wechat）
//   DSH_PLUGINS_NODE         launchd 使用的 node 可执行文件（默认当前 node）
import { execFileSync } from 'node:child_process';
import {
  accessSync,
  chmodSync,
  constants,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmdirSync,
  rmSync,
  unlinkSync,
} from 'node:fs';
import { homedir, platform } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  canonicalizeWithExistingAncestor,
  hardenWechatCredentialDirectory,
  loadOrCreateSecret,
  pathContains,
  pathsOverlap,
  requireSupportedNode,
  validateWechatCredentialDirectory,
  WECHAT_STATE_MARKER,
  WECHAT_STATE_MARKER_CONTENT,
  writePrivateFile,
} from './src/bridge-security.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, 'src');
const LABEL = 'com.dsh.wechatbridge';
const PREFIX = '[dsh-plugins/wechat]';
const PERSISTED_ENV_KEYS = [
  'DSH_BASE',
  'DSH_CWD',
  'WECHAT_BRIDGE_PORT',
  'WECHAT_OWNER',
  'WECHAT_SESSION_ID',
];

function xml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function previousLaunchEnvironment(plist) {
  if (!existsSync(plist)) return {};
  try {
    const raw = execFileSync('/usr/bin/plutil', ['-extract', 'EnvironmentVariables', 'json', '-o', '-', plist], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const value = JSON.parse(raw);
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

export function buildPlist({ nodeBin, dest, logDir, environment }) {
  const environmentXml = Object.entries(environment)
    .filter(([, value]) => typeof value === 'string' && value)
    .map(([key, value]) => `    <key>${xml(key)}</key>\n    <string>${xml(value)}</string>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(nodeBin)}</string>
    <string>${xml(join(dest, 'dsh-wechat-bridge.mjs'))}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${xml(dest)}</string>
  <key>EnvironmentVariables</key>
  <dict>
${environmentXml}
  </dict>
  <key>Umask</key>
  <integer>63</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>${xml(join(logDir, 'bridge.out.log'))}</string>
  <key>StandardErrorPath</key>
  <string>${xml(join(logDir, 'bridge.err.log'))}</string>
</dict>
</plist>
`;
}

function runtimeDir() {
  if (process.env.DSH_PLUGINS_RUNTIME_DIR) return process.env.DSH_PLUGINS_RUNTIME_DIR;
  const home = homedir();
  const preferred = join(home, 'DSH', 'plugins', 'self-built', 'dsh-wechat');
  // 已存在 DSH 工作目录时沿用它；其他机器回退到 Application Support。
  if (existsSync(join(home, 'DSH'))) return preferred;
  return join(home, 'Library', 'Application Support', 'dsh-plugins', 'dsh-wechat');
}

function lstatExisting(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function assertRegularFile(path, description) {
  const stat = lstatExisting(path);
  if (!stat || !stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`${description} must be a regular file: ${path}`);
  }
}

function assertRuntimeIdentity(destination) {
  const stat = lstatExisting(destination);
  if (!stat) return;
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`runtime destination is not a real directory: ${destination}`);
  }
  const entries = readdirSync(destination);
  if (!entries.length) return;
  const manifest = join(destination, 'package.json');
  const bridge = join(destination, 'dsh-wechat-bridge.mjs');
  assertRegularFile(manifest, 'runtime package manifest');
  assertRegularFile(bridge, 'runtime bridge entrypoint');
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(manifest, 'utf8'));
  } catch (error) {
    throw new Error(`runtime package manifest is invalid: ${manifest}`, { cause: error });
  }
  if (parsed?.name !== 'dsh-wechat') {
    throw new Error(`refusing to replace a directory that is not a dsh-wechat runtime: ${destination}`);
  }
}

function validateRuntimeDeploymentPaths(sourceValue, destinationValue, home = homedir()) {
  const source = canonicalizeWithExistingAncestor(sourceValue);
  const destination = canonicalizeWithExistingAncestor(destinationValue);
  const sourceStat = lstatExisting(source);
  if (!sourceStat?.isDirectory() || sourceStat.isSymbolicLink()) {
    throw new Error(`runtime source is not a real directory: ${sourceValue}`);
  }
  const homePath = canonicalizeWithExistingAncestor(home);
  if (dirname(destination) === destination
    || destination === homePath
    || pathContains(destination, homePath)) {
    throw new Error(`unsafe runtime destination: ${destinationValue}`);
  }
  assertNoOverlap(source, destination, 'runtime destination overlaps the package source');
  assertRuntimeIdentity(destination);
  return { source, destination };
}

function assertNoOverlap(left, right, description) {
  if (pathsOverlap(left, right)) throw new Error(description);
}

export function validateInstallationLayout({
  source = SRC,
  destination,
  credDir,
  tokenFile,
  plistDst,
  home = homedir(),
  allowLegacyCredentialDirectory = false,
}) {
  const canonical = {
    source: canonicalizeWithExistingAncestor(source),
    destination: canonicalizeWithExistingAncestor(destination),
    credDir: canonicalizeWithExistingAncestor(credDir),
    tokenFile: canonicalizeWithExistingAncestor(tokenFile),
    plistDst: canonicalizeWithExistingAncestor(plistDst),
    home: canonicalizeWithExistingAncestor(home),
  };
  if (dirname(canonical.destination) === canonical.destination
    || canonical.destination === canonical.home
    || pathContains(canonical.destination, canonical.home)) {
    throw new Error(`unsafe runtime destination: ${destination}`);
  }
  assertNoOverlap(canonical.destination, canonical.source, 'runtime destination overlaps the package source');
  for (const [name, path] of [
    ['credential directory', canonical.credDir],
    ['token file', canonical.tokenFile],
    ['LaunchAgent plist', canonical.plistDst],
  ]) {
    assertNoOverlap(canonical.destination, path, `runtime destination overlaps ${name}`);
    assertNoOverlap(canonical.source, path, `package source overlaps ${name}`);
  }
  assertNoOverlap(canonical.credDir, canonical.plistDst, 'credential directory overlaps the LaunchAgent plist');

  canonical.credDir = validateWechatCredentialDirectory(canonical.credDir, {
    home: canonical.home,
    protectedPaths: [canonical.source, canonical.destination],
    allowLegacy: allowLegacyCredentialDirectory,
  });
  const expectedTokenFile = canonicalizeWithExistingAncestor(join(canonical.credDir, 'bridge-token'));
  if (canonical.tokenFile !== expectedTokenFile) {
    throw new Error('bridge token file must be exactly <credential directory>/bridge-token');
  }
  const stateTargets = [
    canonical.tokenFile,
    join(canonical.credDir, WECHAT_STATE_MARKER),
    join(canonical.credDir, 'owner.json'),
    join(canonical.credDir, 'bridge.out.log'),
    join(canonical.credDir, 'bridge.err.log'),
    canonical.plistDst,
  ].map((path) => canonicalizeWithExistingAncestor(path));
  for (let left = 0; left < stateTargets.length; left += 1) {
    for (let right = left + 1; right < stateTargets.length; right += 1) {
      assertNoOverlap(stateTargets[left], stateTargets[right], 'installation state paths must not overlap');
    }
  }
  assertRuntimeIdentity(canonical.destination);
  return canonical;
}

export function validateNodeBinary(nodeBin, {
  runVersion = (binary) => execFileSync(binary, ['--version'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 5000,
  }),
} = {}) {
  if (typeof nodeBin !== 'string' || !nodeBin.trim()) throw new Error('selected Node executable is required');
  let binary;
  try {
    binary = realpathSync(resolve(nodeBin));
    assertRegularFile(binary, 'selected Node executable');
    accessSync(binary, constants.X_OK);
  } catch (error) {
    throw new Error(`selected Node executable is unavailable: ${nodeBin}`, { cause: error });
  }
  let output;
  try {
    output = String(runVersion(binary)).trim();
  } catch (error) {
    throw new Error(`selected Node executable could not run: ${binary}`, { cause: error });
  }
  const version = output.startsWith('v') ? output.slice(1) : output;
  try {
    requireSupportedNode(version);
  } catch (error) {
    throw new Error(`selected Node executable is unsupported: ${binary} (${output || 'unknown'})`, { cause: error });
  }
  return binary;
}

function vacantDirectoryPath(parent, prefix) {
  const path = mkdtempSync(join(parent, prefix));
  rmdirSync(path);
  return path;
}

function snapshotFile(file, { content = true } = {}) {
  const stat = lstatExisting(file);
  if (!stat) return { file, existed: false, content };
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`installation state must be a regular file: ${file}`);
  }
  return {
    file,
    existed: true,
    content,
    mode: stat.mode & 0o777,
    ...(content ? { data: readFileSync(file) } : {}),
  };
}

function restoreFile(snapshot) {
  const current = lstatExisting(snapshot.file);
  if (!snapshot.existed) {
    if (!current) return;
    if (!current.isFile() || current.isSymbolicLink()) {
      throw new Error(`refusing to remove unexpected rollback target: ${snapshot.file}`);
    }
    unlinkSync(snapshot.file);
    return;
  }
  if (snapshot.content) {
    writePrivateFile(snapshot.file, snapshot.data);
  } else if (!current || !current.isFile() || current.isSymbolicLink()) {
    throw new Error(`cannot restore installation state mode: ${snapshot.file}`);
  }
  chmodSync(snapshot.file, snapshot.mode);
}

function snapshotTreeModes(root) {
  const stat = lstatExisting(root);
  if (!stat) return { root, existed: false, entries: [] };
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`private directory is not a real directory: ${root}`);
  }
  const entries = [{ path: root, mode: stat.mode & 0o777 }];
  const visitMedia = (path) => {
    const item = lstatSync(path);
    if (item.isSymbolicLink()) return;
    if (item.isDirectory() || item.isFile()) entries.push({ path, mode: item.mode & 0o777 });
    if (item.isDirectory()) {
      for (const entry of readdirSync(path)) visitMedia(join(path, entry));
    }
  };
  const knownFiles = new Set([
    WECHAT_STATE_MARKER,
    'credentials.json',
    'sync-buf.json',
    'session.json',
    'owner.json',
    'tokens.json',
    'forward-state.json',
    'bridge-origins.json',
    'bridge-token',
    'bridge.out.log',
    'bridge.err.log',
  ]);
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    if (name === 'media') visitMedia(path);
    else if (knownFiles.has(name) || /^instructed-v4-[^/]+$/.test(name)) {
      const item = lstatSync(path);
      if (item.isFile() && !item.isSymbolicLink()) entries.push({ path, mode: item.mode & 0o777 });
    }
  }
  return { root, existed: true, entries };
}

function restoreTreeModes(snapshot) {
  if (!snapshot.existed) return;
  for (const entry of [...snapshot.entries].sort((left, right) => right.path.length - left.path.length)) {
    chmodSync(entry.path, entry.mode);
  }
}

function snapshotMissingDirectories(directories) {
  const missing = new Set();
  for (const directory of directories) {
    let cursor = resolve(directory);
    for (;;) {
      const stat = lstatExisting(cursor);
      if (stat) {
        if (!stat.isDirectory() || stat.isSymbolicLink()) {
          throw new Error(`installation parent is not a real directory: ${cursor}`);
        }
        break;
      }
      missing.add(cursor);
      const parent = dirname(cursor);
      if (parent === cursor) break;
      cursor = parent;
    }
  }
  return [...missing].sort((left, right) => right.length - left.length);
}

function removeCreatedDirectories(directories) {
  const errors = [];
  for (const directory of directories) {
    try {
      rmdirSync(directory);
    } catch (error) {
      if (error?.code !== 'ENOENT') errors.push(error);
    }
  }
  return errors;
}

function beginRuntimeDeployment({
  source = SRC,
  destination,
  installDependencies = (staging) => {
    execFileSync('npm', ['ci', '--omit=dev', '--no-audit', '--no-fund'], { cwd: staging, stdio: 'inherit' });
  },
}) {
  const validated = validateRuntimeDeploymentPaths(source, destination);
  source = validated.source;
  const dest = validated.destination;
  const parent = dirname(dest);
  mkdirSync(parent, { recursive: true });
  const staging = mkdtempSync(join(parent, `.${basename(dest)}.staging-`));
  chmodSync(staging, 0o700);
  let backup = null;
  let swapped = false;
  let settled = false;

  try {
    for (const entry of readdirSync(source, { withFileTypes: true })) {
      if (entry.isFile()) copyFileSync(join(source, entry.name), join(staging, entry.name));
    }
    installDependencies(staging);

    if (existsSync(dest)) {
      const stat = lstatSync(dest);
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw new Error(`runtime destination is not a real directory: ${dest}`);
      }
      backup = vacantDirectoryPath(parent, `.${basename(dest)}.backup-`);
      renameSync(dest, backup);
    }

    try {
      renameSync(staging, dest);
      swapped = true;
    } catch (swapError) {
      if (backup && existsSync(backup) && !existsSync(dest)) {
        renameSync(backup, dest);
        backup = null;
      }
      throw swapError;
    }
  } catch (error) {
    if (backup && existsSync(backup) && !existsSync(dest)) {
      try {
        renameSync(backup, dest);
        backup = null;
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], `runtime deployment and rollback failed: ${dest}`);
      }
    }
    throw error;
  } finally {
    if (existsSync(staging)) rmSync(staging, { recursive: true, force: true });
  }

  return {
    dest,
    commit() {
      if (settled) return;
      if (backup) {
        try {
          rmSync(backup, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
        } catch (error) {
          console.warn(`${PREFIX} 旧运行目录清理失败，可稍后手动删除 ${backup}: ${error.message}`);
        }
        backup = null;
      }
      settled = true;
    },
    rollback() {
      if (settled) throw new Error('runtime deployment transaction is already settled');
      let displaced = null;
      try {
        if (swapped && lstatExisting(dest)) {
          displaced = vacantDirectoryPath(parent, `.${basename(dest)}.rollback-`);
          renameSync(dest, displaced);
        }
        if (backup) {
          renameSync(backup, dest);
          backup = null;
        }
        if (displaced) rmSync(displaced, { recursive: true, force: true });
        displaced = null;
        swapped = false;
        settled = true;
      } catch (error) {
        const recoveryErrors = [error];
        if (displaced && lstatExisting(displaced) && !lstatExisting(dest)) {
          try {
            renameSync(displaced, dest);
            displaced = null;
          } catch (restoreError) {
            recoveryErrors.push(restoreError);
          }
        }
        throw new AggregateError(recoveryErrors, `runtime rollback failed: ${dest}`);
      }
    },
  };
}

export function deployRuntimeAtomically(options) {
  const transaction = beginRuntimeDeployment(options);
  transaction.commit();
  return transaction.dest;
}

export function prepareWechatInstallation({
  source = SRC,
  destination,
  credDir,
  tokenFile,
  plistDst,
  nodeBin,
  environment,
  configuredToken,
  configuredOwner,
  installDependencies,
  writePrivate = writePrivateFile,
  deferCommit = false,
  home = homedir(),
  allowLegacyCredentialDirectory = false,
}) {
  const paths = validateInstallationLayout({
    source,
    destination,
    credDir,
    tokenFile,
    plistDst,
    home,
    allowLegacyCredentialDirectory,
  });
  source = paths.source;
  destination = paths.destination;
  credDir = paths.credDir;
  tokenFile = paths.tokenFile;
  plistDst = paths.plistDst;

  const ownerFile = join(credDir, 'owner.json');
  const markerFile = join(credDir, WECHAT_STATE_MARKER);
  const logFiles = ['bridge.out.log', 'bridge.err.log'].map((name) => join(credDir, name));
  const treeSnapshot = snapshotTreeModes(credDir);
  const fileSnapshots = [
    snapshotFile(tokenFile),
    snapshotFile(markerFile),
    ...(typeof configuredOwner === 'string' && configuredOwner.trim() ? [snapshotFile(ownerFile)] : []),
    ...logFiles.map((file) => snapshotFile(file, { content: false })),
    snapshotFile(plistDst),
  ];
  const createdDirectories = snapshotMissingDirectories([
    dirname(destination),
    credDir,
    dirname(tokenFile),
    dirname(plistDst),
  ]);

  let runtimeTransaction = null;
  let active = true;
  const restorePrivateState = () => {
    const errors = [];
    for (const snapshot of [...fileSnapshots].reverse()) {
      try {
        restoreFile(snapshot);
      } catch (error) {
        errors.push(error);
      }
    }
    try {
      restoreTreeModes(treeSnapshot);
    } catch (error) {
      errors.push(error);
    }
    return errors;
  };
  const rollbackAll = () => {
    const errors = restorePrivateState();
    if (runtimeTransaction) {
      try {
        runtimeTransaction.rollback();
      } catch (error) {
        errors.push(error);
      }
    }
    errors.push(...removeCreatedDirectories(createdDirectories));
    if (errors.length) throw new AggregateError(errors, 'installation rollback failed');
  };

  let bridgeToken;
  try {
    hardenWechatCredentialDirectory(credDir);
    runtimeTransaction = beginRuntimeDeployment({ source, destination, installDependencies });
    writePrivate(markerFile, WECHAT_STATE_MARKER_CONTENT);
    bridgeToken = loadOrCreateSecret(tokenFile, configuredToken);
    if (typeof configuredOwner === 'string' && configuredOwner.trim()) {
      writePrivate(ownerFile, `${JSON.stringify({ userId: configuredOwner.trim() }, null, 2)}\n`);
    }
    for (const file of logFiles) {
      if (!existsSync(file)) writePrivate(file, '');
      else chmodSync(file, 0o600);
    }
    mkdirSync(dirname(plistDst), { recursive: true });
    const plist = buildPlist({ nodeBin, dest: runtimeTransaction.dest, logDir: credDir, environment });
    writePrivate(plistDst, plist);
  } catch (error) {
    try {
      rollbackAll();
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], 'installation preparation and rollback failed');
    }
    throw error;
  }

  const installation = {
    dest: runtimeTransaction.dest,
    bridgeToken,
    commit() {
      if (!active) return;
      runtimeTransaction.commit();
      active = false;
    },
    rollback() {
      if (!active) throw new Error('installation transaction is already settled');
      rollbackAll();
      active = false;
    },
  };
  if (!deferCommit) installation.commit();
  return installation;
}

function loadLaunchAgent({ uid, plistDst, runLaunchctl }) {
  try {
    runLaunchctl(['bootstrap', `gui/${uid}`, plistDst]);
  } catch (bootstrapError) {
    try {
      runLaunchctl(['load', plistDst]);
    } catch (loadError) {
      throw new AggregateError([bootstrapError, loadError], 'launchd could not load the WeChat bridge');
    }
  }
}

export function activatePreparedInstallation({
  installation,
  running,
  uid,
  plistDst,
  label = LABEL,
  runLaunchctl = (args) => execFileSync('launchctl', args, { stdio: 'inherit' }),
}) {
  let stopped = false;
  try {
    if (running) {
      runLaunchctl(['bootout', `gui/${uid}/${label}`]);
      stopped = true;
    }
    loadLaunchAgent({ uid, plistDst, runLaunchctl });
    installation.commit();
  } catch (error) {
    const recoveryErrors = [];
    if (stopped) {
      try {
        runLaunchctl(['bootout', `gui/${uid}/${label}`]);
      } catch (cleanupError) {
        recoveryErrors.push(cleanupError);
      }
    }
    try {
      installation.rollback();
    } catch (rollbackError) {
      recoveryErrors.push(rollbackError);
    }
    if (running && stopped) {
      try {
        loadLaunchAgent({ uid, plistDst, runLaunchctl });
      } catch (restoreError) {
        recoveryErrors.push(restoreError);
      }
    }
    if (recoveryErrors.length) {
      throw new AggregateError(
        [error, ...recoveryErrors],
        `launchd activation failed and recovery reported additional errors: ${error.message}`,
      );
    }
    throw error;
  }
}

export function installWechatService({
  selectedNodeBin,
  runNodeVersion,
  prepareOptions,
  uid,
  plistDst,
  label = LABEL,
  runLaunchctl = (args, options = { stdio: 'inherit' }) => execFileSync('launchctl', args, options),
}) {
  // This guard intentionally precedes preparation and even the read-only
  // launchctl probe. An invalid launchd interpreter must produce zero writes.
  const nodeBin = validateNodeBinary(selectedNodeBin, { runVersion: runNodeVersion });
  const installation = prepareWechatInstallation({
    ...prepareOptions,
    nodeBin,
    plistDst,
    deferCommit: true,
  });
  let running = false;
  try {
    runLaunchctl(['print', `gui/${uid}/${label}`], { stdio: 'ignore' });
    running = true;
  } catch {}
  activatePreparedInstallation({
    installation,
    running,
    uid,
    plistDst,
    label,
    runLaunchctl: (args) => runLaunchctl(args, { stdio: 'inherit' }),
  });
  return { installation, nodeBin, running };
}

function main() {
  try {
    requireSupportedNode();
  } catch (error) {
    console.error(`${PREFIX} ${error.message}`);
    process.exitCode = 1;
    return;
  }
  if (platform() !== 'darwin') {
    console.error(`${PREFIX} 目前仅支持 macOS（launchd 服务）`);
    process.exitCode = 1;
    return;
  }
  const dest = resolve(runtimeDir());

  const plistDst = join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
  const previousEnvironment = previousLaunchEnvironment(plistDst);
  const credDir = resolve(
    process.env.WECHAT_CRED_DIR
      || previousEnvironment.WECHAT_CRED_DIR
      || join(homedir(), '.dsh-wechat'),
  );
  const tokenFile = resolve(
    process.env.WECHAT_BRIDGE_TOKEN_FILE
      || previousEnvironment.WECHAT_BRIDGE_TOKEN_FILE
      || join(credDir, 'bridge-token'),
  );
  const legacyToken = previousEnvironment.WECHAT_BRIDGE_TOKEN;
  const selectedNodeBin = process.env.DSH_PLUGINS_NODE || process.execPath;
  const logDir = credDir;
  const environment = {
    WECHAT_CRED_DIR: credDir,
    WECHAT_BRIDGE_TOKEN_FILE: tokenFile,
  };
  for (const key of PERSISTED_ENV_KEYS) {
    const value = process.env[key] || previousEnvironment[key];
    if (typeof value === 'string' && value) environment[key] = value;
  }
  console.log(`${PREFIX} 在私有临时目录按 package-lock.json 准备运行时（npm ci）…`);
  const uid = process.getuid();
  const defaultCredDir = resolve(join(homedir(), '.dsh-wechat'));
  const { running } = installWechatService({
    selectedNodeBin,
    uid,
    plistDst,
    prepareOptions: {
      destination: dest,
      credDir,
      tokenFile,
      environment,
      configuredToken: process.env.WECHAT_BRIDGE_TOKEN || legacyToken,
      configuredOwner: process.env.WECHAT_OWNER || previousEnvironment.WECHAT_OWNER,
      allowLegacyCredentialDirectory: canonicalizeWithExistingAncestor(credDir)
        === canonicalizeWithExistingAncestor(defaultCredDir),
    },
  });

  // 4. launchctl 启动/刷新。升级必须重新载入 plist 并重启，确保新源码/依赖/环境生效。
  console.log(`${PREFIX} 运行时已原子部署: ${dest}`);
  console.log(`${PREFIX} plist 已生成: ${plistDst}`);
  console.log(`${PREFIX} 本地接口 token: ${tokenFile}（权限 0600）`);
  console.log(`${PREFIX} 聊天服务已${running ? '重启并加载升级' : '启动'}: ${LABEL}`);
  console.log(`${PREFIX} 首次使用需手机微信扫码登录，登录结果会自动绑定唯一 owner，见 src/README.md（日志: ${logDir}/bridge.out.log）`);

  // 5. 首页微信快捷入口（UI 补丁，HMR 自动热更新）
  console.log(`${PREFIX} 应用首页微信快捷入口补丁…`);
  try {
    execFileSync(process.execPath, [join(HERE, 'ui', 'reapply.mjs')], { stdio: 'inherit' });
  } catch (e) {
    console.error(`${PREFIX} UI 补丁执行失败: ${e.message}`);
  }
}

export function isMainModule(argv1, modulePath = fileURLToPath(import.meta.url)) {
  if (!argv1) return false;
  try {
    return realpathSync(argv1) === realpathSync(modulePath);
  } catch {
    return false;
  }
}

if (isMainModule(process.argv[1])) main();
