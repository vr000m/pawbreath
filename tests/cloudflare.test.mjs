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
  writeFileSync(envFile, 'CLOUDFLARE_API_TOKEN=file-token\nCLOUDFLARE_ACCOUNT_ID=file-account\n');
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
    run(command, overrides = {}) {
      const result = spawnSync('bash', [script, command], {
        cwd: tmpdir(), encoding: 'utf8',
        env: { ...process.env, CLOUDFLARE_API_TOKEN: 'fixture-token', CLOUDFLARE_ENV_FILE: '', CALL_LOG: log, AUTH_EXIT: '0', ...overrides },
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
  assert.deepEqual(result.calls, [{ command: 'whoami', args: [], exportedToken: true, fileToken: false, fileAccount: false }]);
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
