import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('./catbox', import.meta.url));
const FIXTURE = fileURLToPath(new URL('../public/default-image.png', import.meta.url));

function runCli(args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(CLI, args, {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      resolve({ code, signal, stdout, stderr });
    });
  });
}

async function startServer(handler) {
  const requests = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      requests.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: Buffer.concat(chunks),
      });
      handler(req, res, requests.length);
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();

  return {
    base: `http://127.0.0.1:${address.port}`,
    requests,
    close: () =>
      new Promise((resolve, reject) => {
        server.closeAllConnections?.();
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

function uploadOk(req, res, count) {
  res.writeHead(201, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ url: `http://example.test/upload-${count}.png`, name: 'image.png' }));
}

async function makeTempDir(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'catbox-cli-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

async function makeFolderFixture(t) {
  const dir = await makeTempDir(t);
  const folder = path.join(dir, 'folder');
  const nested = path.join(folder, 'nested');

  await mkdir(nested, { recursive: true });
  await copyFile(FIXTURE, path.join(dir, 'image.png'));
  await copyFile(FIXTURE, path.join(folder, 'image.png'));
  await copyFile(FIXTURE, path.join(nested, 'nested.png'));
  await writeFile(path.join(folder, 'notes.txt'), 'not an image');

  return { dir, folder };
}

test('uploads a single file', async (t) => {
  const server = await startServer(uploadOk);
  t.after(() => server.close());
  const dir = await makeTempDir(t);
  await copyFile(FIXTURE, path.join(dir, 'image.png'));

  const result = await runCli([path.join(dir, 'image.png'), '--base-url', server.base]);

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^http:\/\/example\.test\/upload-1\.png\n$/);
  assert.equal(server.requests.length, 1);
  assert.match(result.stderr, /Uploaded 1 of 1 image/);
});

test('uses CATBOX_URL when --base-url is omitted', async (t) => {
  const server = await startServer(uploadOk);
  t.after(() => server.close());
  const dir = await makeTempDir(t);
  await copyFile(FIXTURE, path.join(dir, 'image.png'));

  const result = await runCli([path.join(dir, 'image.png')], { CATBOX_URL: server.base });

  assert.equal(result.code, 0, result.stderr);
  assert.equal(server.requests.length, 1);
});

test('folder uploads are non-recursive unless --recursive is set', async (t) => {
  const server = await startServer(uploadOk);
  t.after(() => server.close());
  const { folder } = await makeFolderFixture(t);

  const shallow = await runCli([folder, '--base-url', server.base]);
  assert.equal(shallow.code, 0, shallow.stderr);
  assert.equal(server.requests.length, 1);

  const deep = await runCli([folder, '--recursive', '--base-url', server.base]);
  assert.equal(deep.code, 0, deep.stderr);
  assert.equal(server.requests.length, 3);
});

test('prints structured JSON results', async (t) => {
  const server = await startServer(uploadOk);
  t.after(() => server.close());
  const { folder } = await makeFolderFixture(t);

  const result = await runCli([
    folder,
    '--recursive',
    '--json',
    '--base-url',
    server.base,
  ]);

  assert.equal(result.code, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.uploaded, 2);
  assert.equal(payload.failed, 0);
  assert.equal(payload.files.length, 2);
  assert.ok(payload.files.every((file) => typeof file.url === 'string'));
});

test('reports a missing path', async (t) => {
  const server = await startServer(uploadOk);
  t.after(() => server.close());
  const dir = await makeTempDir(t);

  const result = await runCli([path.join(dir, 'missing.png'), '--base-url', server.base]);

  assert.equal(result.code, 1);
  assert.match(result.stderr, /path not found/);
  assert.equal(server.requests.length, 0);
});

test('retries a rate-limited upload', async (t) => {
  const server = await startServer((req, res, count) => {
    if (count === 1) {
      res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '1' });
      res.end(JSON.stringify({ error: 'rate limited' }));
      return;
    }
    uploadOk(req, res, count);
  });
  t.after(() => server.close());
  const dir = await makeTempDir(t);
  await copyFile(FIXTURE, path.join(dir, 'image.png'));

  const result = await runCli([path.join(dir, 'image.png'), '--base-url', server.base]);

  assert.equal(result.code, 0, result.stderr);
  assert.equal(server.requests.length, 2);
  assert.match(result.stdout, /upload-2\.png/);
});

test('rejects oversized files before uploading', async (t) => {
  const server = await startServer(uploadOk);
  t.after(() => server.close());
  const dir = await makeTempDir(t);
  const big = path.join(dir, 'big.png');
  await writeFile(big, Buffer.alloc(10 * 1024 * 1024 + 1));

  const result = await runCli([big, '--base-url', server.base]);

  assert.equal(result.code, 1);
  assert.match(result.stderr, /too large/);
  assert.equal(server.requests.length, 0);
});

test('shows usage help', async () => {
  const result = await runCli(['--help']);

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Upload images to Catbox/);
  assert.match(result.stdout, /--base-url/);
  assert.match(result.stdout, /--recursive/);
});
