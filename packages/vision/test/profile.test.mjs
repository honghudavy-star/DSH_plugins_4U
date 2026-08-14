import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PATCH_PROFILE = join(HERE, '..', 'patch-profile.mjs');

function temporaryDirectory(t) {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-vision-profile-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function runPatch(profile, lumaPath) {
  return execFileSync(process.execPath, [PATCH_PROFILE], {
    env: {
      ...process.env,
      DSH_PROFILE_FILE: profile,
      DSH_VISION_LUMA_DIR: lumaPath,
      SILICONFLOW_API_KEY: '',
    },
    encoding: 'utf8',
  });
}

test('profile update repairs a stale luma path, backs up atomically, and is idempotent', (t) => {
  const root = temporaryDirectory(t);
  const profileDirectory = join(root, 'profiles', 'web');
  const profile = join(profileDirectory, 'cordis.patch.yml');
  const lumaPath = join(root, "new luma's runtime");
  mkdirSync(profileDirectory, { recursive: true });
  const original = `- insert:
    - id: mcp-vision
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: vision
        transport: stdio
        command: node
        args:
          - /stale/luma/build/index.js
        env:
          MODEL_PROVIDER: siliconflow
          SILICONFLOW_API_KEY: 'fixture-secret'

- id: system-prompt
  config:
    persona: >-
      You are a coding agent.
    trailingOption: keep-me
`;
  writeFileSync(profile, original, { mode: 0o644 });
  chmodSync(profileDirectory, 0o755);

  const firstOutput = runPatch(profile, lumaPath);
  const first = readFileSync(profile, 'utf8');
  const firstMtime = statSync(profile).mtimeMs;
  assert.match(firstOutput, /已更新 mcp-vision/);
  assert.ok(first.includes(`- '${join(lumaPath, 'build', 'index.js').replaceAll("'", "''")}'`));
  assert.ok(first.includes("SILICONFLOW_API_KEY: 'fixture-secret'"));
  assert.equal(first.match(/You MUST call the image_understand tool/g)?.length, 1);
  assert.ok(first.indexOf('You MUST call the image_understand tool') < first.indexOf('trailingOption: keep-me'));
  assert.match(first, /      without calling the tool\. If image_understand fails, report the error honestly\.\n    trailingOption: keep-me/);
  assert.equal(readFileSync(`${profile}.bak`, 'utf8'), original);
  assert.equal(statSync(profile).mode & 0o777, 0o600);
  assert.equal(statSync(`${profile}.bak`).mode & 0o777, 0o600);
  assert.equal(statSync(profileDirectory).mode & 0o777, 0o700);

  const secondOutput = runPatch(profile, lumaPath);
  assert.match(secondOutput, /配置未变化/);
  assert.equal(readFileSync(profile, 'utf8'), first);
  assert.equal(statSync(profile).mtimeMs, firstMtime);
  assert.equal(readFileSync(`${profile}.bak`, 'utf8'), original);
  assert.equal(first.match(/id: mcp-vision/g)?.length, 1);
});

test('profile update follows an existing symlink without replacing it', (t) => {
  const root = temporaryDirectory(t);
  const profileDirectory = join(root, 'profiles', 'web');
  const managedDirectory = join(root, 'managed-config');
  const managedProfile = join(managedDirectory, 'cordis.patch.yml');
  const profileLink = join(profileDirectory, 'cordis.patch.yml');
  const lumaPath = join(root, 'luma-runtime');
  mkdirSync(profileDirectory, { recursive: true });
  mkdirSync(managedDirectory, { recursive: true });
  const original = `- insert:
    - id: mcp-vision
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        args:
          - /stale/luma/build/index.js
        env:
          SILICONFLOW_API_KEY: 'fixture-secret'
`;
  writeFileSync(managedProfile, original, { mode: 0o644 });
  symlinkSync(managedProfile, profileLink);

  runPatch(profileLink, lumaPath);

  assert.equal(lstatSync(profileLink).isSymbolicLink(), true);
  assert.match(readFileSync(managedProfile, 'utf8'), new RegExp(join(lumaPath, 'build', 'index.js').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(readFileSync(`${managedProfile}.bak`, 'utf8'), original);
  assert.equal(statSync(managedProfile).mode & 0o777, 0o600);
  assert.equal(statSync(`${managedProfile}.bak`).mode & 0o777, 0o600);
});
