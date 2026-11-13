import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'pawbreath-cloudflare-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'scripts'));
  mkdirSync(join(root, 'node_modules', '.bin'), { recursive: true });
  const script = join(root, 'scripts', 'cloudflare.sh');
  copyFileSync(new URL('../scripts/cloudflare.sh', import.meta.url), script);
  const log = join(root, 'calls.jsonl');
  const envFile = join(root, 'credentials.env');
  const credentials = 'CLOUDFLARE_API_TOKEN=file-token\nCLOUDFLARE_ACCOUNT_ID=file-account\n';
  writeFileSync(envFile, credentials);
  // The wrapper's default credential file lives under HOME; point HOME at the fixture.
  mkdirSync(join(root, '.secrets'));
  writeFileSync(join(root, '.secrets', 'cf.env'), credentials);
  writeFileSync(join(root, 'node_modules', '.bin', 'wrangler'), `#!/usr/bin/env node
const fs = require('node:fs');
const command = process.argv[2];
fs.appendFileSync(process.env.CALL_LOG, JSON.stringify({
  command,
  args: process.argv.slice(3),
  exportedToken: process.env.CLOUDFLARE_API_TOKEN === 'fixture-token',
  fileToken: process.env.CLOUDFLARE_API_TOKEN === 'file-token',
  fileAccount: process.env.CLOUDFLARE_ACCOUNT_ID === 'file-account'
}) + '\\n');
process.exit(command === 'whoami' ? Number(process.env.AUTH_EXIT || 0) : 0);
`, { mode: 0o755 });
  return {
    envFile,
    root,
    run(command, overrides = {}) {
      const result = spawnSync('bash', [script, command], {
        cwd: tmpdir(), encoding: 'utf8',
        env: { ...process.env, HOME: root, CLOUDFLARE_API_TOKEN: 'fixture-token', CLOUDFLARE_ENV_FILE: '', CALL_LOG: log, AUTH_EXIT: '0', ...overrides },
      });
      const calls = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [];
      return { ...result, calls };
    },
  };
}

test('Cloudflare wrapper uses exported credentials without loading the default file', t => {
  const { run } = fixture(t);
  const result = run('whoami');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.calls, [{ command: 'whoami', args: ['--json'], exportedToken: true, fileToken: false, fileAccount: false }]);
});

test('Cloudflare wrapper loads the default credential file when no token is exported', t => {
  const { run } = fixture(t);
  const result = run('whoami', { CLOUDFLARE_API_TOKEN: '' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.calls, [{ command: 'whoami', args: ['--json'], exportedToken: false, fileToken: true, fileAccount: true }]);
});

test('Cloudflare wrapper loads an explicit external file and authenticates before deploy', t => {
  const { run, envFile } = fixture(t);
  const result = run('deploy', { CLOUDFLARE_ENV_FILE: envFile });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.calls.map(call => call.command), ['whoami', 'deploy']);
  assert.deepEqual(result.calls[0].args, ['--json']);
  assert.ok(result.calls.every(call => call.fileToken && call.fileAccount && !call.exportedToken));
});

test('Cloudflare wrapper does not deploy when authentication fails', t => {
  const { run } = fixture(t);
  const result = run('deploy', { AUTH_EXIT: '7' });
  assert.equal(result.status, 7);
  assert.deepEqual(result.calls.map(call => call.command), ['whoami']);
  assert.deepEqual(result.calls[0].args, ['--json']);
});

test('Cloudflare wrapper rejects a missing explicit credential file before running Wrangler', t => {
  const { run, envFile } = fixture(t);
  const result = run('deploy', { CLOUDFLARE_ENV_FILE: envFile + '.missing' });
  assert.notEqual(result.status, 0);
  assert.deepEqual(result.calls, []);
});

// State space for CLOUDFLARE_ENV_FILE: the value is consumed after the script cd's to the repo root
// and bash `source` searches PATH for slash-less names, so only absolute paths are unambiguous.
test('Cloudflare wrapper accepts only absolute CLOUDFLARE_ENV_FILE values', t => {
  const cases = [
    { name: 'unset', file: () => '', token: 'fixture-token', ok: true, loaded: false },
    { name: 'unset, no token', file: () => '', token: '', ok: true, loaded: true },
    { name: 'absolute existing over exported token', file: f => f.envFile, token: 'fixture-token', ok: true, loaded: true },
    { name: 'absolute missing', file: f => f.envFile + '.missing', token: 'fixture-token', ok: false },
    { name: 'relative with slash', file: () => './credentials.env', token: 'fixture-token', ok: false },
    { name: 'relative subpath', file: () => 'decoy-path/credentials.env', token: 'fixture-token', ok: false },
    { name: 'bare name present at repo root', file: () => 'credentials.env', token: 'fixture-token', ok: false },
    { name: 'bare name present on PATH', file: () => 'credentials.env', token: '', ok: false, onPath: true },
    { name: 'tilde (unexpanded)', file: () => '~/credentials.env', token: 'fixture-token', ok: false },
  ];
  for (const c of cases) {
    // A fresh fixture per case keeps the call log isolated. Same-named decoys sit at the script's
    // repo root (credentials.env) and in a PATH directory, the two places a relative value could resolve.
    const f = fixture(t);
    const decoyDir = join(f.root, 'decoy-path');
    mkdirSync(decoyDir);
    copyFileSync(f.envFile, join(decoyDir, 'credentials.env'));
    const overrides = { CLOUDFLARE_ENV_FILE: c.file(f), CLOUDFLARE_API_TOKEN: c.token };
    if (c.onPath) overrides.PATH = decoyDir + ':' + process.env.PATH;
    const result = f.run('deploy', overrides);
    if (c.ok) {
      assert.equal(result.status, 0, `${c.name}: ${result.stderr}`);
      assert.ok(result.calls.length > 0 && result.calls.every(call => call.fileToken === c.loaded), c.name);
    } else {
      assert.notEqual(result.status, 0, c.name);
      assert.deepEqual(result.calls, [], c.name);
      if (!overrides.CLOUDFLARE_ENV_FILE.startsWith('/')) assert.match(result.stderr, /absolute path/, c.name);
    }
  }
});
