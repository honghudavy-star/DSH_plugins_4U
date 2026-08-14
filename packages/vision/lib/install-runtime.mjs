import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
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
} from 'node:fs';
import { homedir } from 'node:os';
import {
  dirname,
  isAbsolute,
  join,
  parse,
  relative,
  resolve,
  sep,
} from 'node:path';

const LUMA_PACKAGE_NAME = 'luma-mcp';

export const NPM_CI_ARGS = Object.freeze([
  'ci',
  '--omit=dev',
  '--no-audit',
  '--no-fund',
]);

function npmExecutable() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function lstatExisting(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function isSameOrAncestor(ancestor, candidate) {
  const child = relative(ancestor, candidate);
  return child === '' || (!isAbsolute(child) && child !== '..' && !child.startsWith(`..${sep}`));
}

/** Resolve every existing path component without creating the missing tail. */
function canonicalPotentialPath(candidate) {
  const absolute = resolve(candidate);
  const missing = [];
  let cursor = absolute;
  for (;;) {
    const stat = lstatExisting(cursor);
    if (stat) {
      const canonical = realpathSync(cursor);
      if (missing.length > 0 && !lstatSync(canonical).isDirectory()) {
        throw new Error(`deployment path ancestor is not a directory: ${cursor}`);
      }
      return resolve(canonical, ...missing.reverse());
    }
    const parent = dirname(cursor);
    if (parent === cursor) throw new Error(`cannot resolve deployment path: ${absolute}`);
    missing.push(parse(cursor).base);
    cursor = parent;
  }
}

function regularFile(path) {
  const stat = lstatExisting(path);
  return Boolean(stat?.isFile() && !stat.isSymbolicLink());
}

function readJsonFile(path) {
  if (!regularFile(path)) return null;
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'));
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

function runtimeIdentity(directory) {
  const manifest = readJsonFile(join(directory, 'package.json'));
  const lock = readJsonFile(join(directory, 'package-lock.json'));
  const rootLock = lock?.packages?.[''] ?? lock;
  const version = typeof manifest?.version === 'string' ? manifest.version.trim() : '';
  if (
    manifest?.name !== LUMA_PACKAGE_NAME
    || !version
    || rootLock?.name !== LUMA_PACKAGE_NAME
    || rootLock?.version !== version
    || !regularFile(join(directory, 'build', 'index.js'))
  ) {
    return null;
  }
  return { name: manifest.name, version };
}

function validateSource(source) {
  const canonical = realpathSync(resolve(source));
  const stat = lstatSync(canonical);
  if (!stat.isDirectory() || !runtimeIdentity(canonical)) {
    throw new Error(`luma-mcp source is incomplete or has an invalid identity: ${source}`);
  }
  return canonical;
}

/**
 * Validate every destructive boundary before mkdir, staging, chmod, npm, or rename.
 * Returns canonical paths so a symlinked existing ancestor cannot be retargeted
 * between validation and deployment.
 */
export function validateLumaDeployment(source, destination, options = {}) {
  if (typeof source !== 'string' || !source.trim()) throw new Error('luma-mcp source path is required');
  if (typeof destination !== 'string' || !destination.trim()) throw new Error('luma-mcp destination path is required');

  const canonicalSource = validateSource(source);
  const requestedDestination = resolve(destination);
  const destinationStat = lstatExisting(requestedDestination);
  if (destinationStat?.isSymbolicLink()) {
    throw new Error(`refusing to replace a symbolic-link runtime destination: ${requestedDestination}`);
  }
  const canonicalDestination = canonicalPotentialPath(requestedDestination);
  const filesystemRoot = parse(canonicalDestination).root;
  if (canonicalDestination === filesystemRoot) {
    throw new Error(`refusing to deploy luma-mcp over a filesystem root: ${canonicalDestination}`);
  }

  const canonicalHome = canonicalPotentialPath(options.homeDirectory ?? homedir());
  if (isSameOrAncestor(canonicalDestination, canonicalHome)) {
    throw new Error(`refusing to deploy luma-mcp over HOME or one of its ancestors: ${canonicalDestination}`);
  }
  if (
    isSameOrAncestor(canonicalSource, canonicalDestination)
    || isSameOrAncestor(canonicalDestination, canonicalSource)
  ) {
    throw new Error(`luma-mcp source and destination must not overlap: ${canonicalDestination}`);
  }

  const canonicalStat = lstatExisting(canonicalDestination);
  if (canonicalStat) {
    if (!canonicalStat.isDirectory() || canonicalStat.isSymbolicLink()) {
      throw new Error(`luma-mcp destination is not a real directory: ${canonicalDestination}`);
    }
    if (readdirSync(canonicalDestination).length > 0 && !runtimeIdentity(canonicalDestination)) {
      throw new Error(`refusing to replace a non-empty directory that is not a verified luma-mcp runtime: ${canonicalDestination}`);
    }
  }

  return {
    source: canonicalSource,
    destination: canonicalDestination,
  };
}

function vacantPath(parent, prefix) {
  const path = mkdtempSync(join(parent, prefix));
  rmdirSync(path);
  return path;
}

/**
 * Build a complete luma runtime beside the destination and swap it into place.
 * An npm or copy failure therefore leaves the last working runtime untouched.
 */
export function deployLumaRuntime(source, destination, options = {}) {
  const run = options.run ?? execFileSync;
  const validated = validateLumaDeployment(source, destination, options);
  const parent = dirname(validated.destination);
  mkdirSync(parent, { recursive: true, mode: 0o700 });

  const stage = mkdtempSync(join(parent, '.luma-mcp-stage-'));
  const backup = vacantPath(parent, '.luma-mcp-backup-');
  let oldRuntimeMoved = false;
  let stageCommitted = false;

  try {
    cpSync(validated.source, stage, { recursive: true, force: true });
    chmodSync(stage, 0o700);
    run(npmExecutable(), [...NPM_CI_ARGS], {
      cwd: stage,
      stdio: 'inherit',
    });
    if (!runtimeIdentity(stage)) {
      throw new Error('staged luma-mcp runtime failed identity validation after npm ci');
    }

    if (existsSync(validated.destination)) {
      renameSync(validated.destination, backup);
      oldRuntimeMoved = true;
    }
    renameSync(stage, validated.destination);
    stageCommitted = true;
    if (oldRuntimeMoved) {
      try {
        rmSync(backup, { recursive: true, force: true });
        oldRuntimeMoved = false;
      } catch (error) {
        (options.warn ?? console.warn)(`old luma-mcp runtime remains at ${backup}: ${error.message}`);
      }
    }
  } catch (error) {
    const rollbackErrors = [];
    if (!stageCommitted && oldRuntimeMoved && existsSync(backup)) {
      if (!existsSync(validated.destination)) {
        try {
          renameSync(backup, validated.destination);
          oldRuntimeMoved = false;
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError);
        }
      } else {
        rollbackErrors.push(new Error(`unexpected path blocked runtime rollback: ${validated.destination}`));
      }
    }
    rmSync(stage, { recursive: true, force: true });
    if (rollbackErrors.length > 0) {
      throw new AggregateError([error, ...rollbackErrors], `luma-mcp deployment and rollback failed: ${validated.destination}`);
    }
    throw error;
  }
  return validated.destination;
}
