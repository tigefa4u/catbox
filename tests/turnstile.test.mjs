import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createTestHarness } from 'wrangler';
import { verifyTurnstile } from '../src/turnstile.ts';

const png = await readFile(new URL('./fixtures/plain.png', import.meta.url));

function upload(url, path, headers = {}) {
  const body = new FormData();
  body.append('fileToUpload', new Blob([png]), 'test.png');
  return fetch(new URL(path, url), { method: 'POST', body, headers });
}

test('configured website rejects missing tokens before storage; public API and CORS still work', async (t) => {
  const server = createTestHarness({ workers: [{
    configPath: 'wrangler.jsonc',
    vars: { TURNSTILE_SITE_KEY: 'test-site-key' },
    secrets: { TURNSTILE_SECRET_KEY: 'test-only-secret' },
  }] });
  t.after(() => server.close());
  const { url } = await server.listen();
  const worker = server.getWorker();
  const home = await worker.fetch('/');
  assert.ok(home.headers.get("Content-Security-Policy").includes("frame-src https://challenges.cloudflare.com"));
  const html = await home.text();
  assert.ok(html.includes('action="/web/upload"'));
  assert.match(html, /data-site-key="test-site-key"/);
  assert.doesNotMatch(html, /test-only-secret/);
  assert.equal((await upload(url, '/web/upload')).status, 403);
  assert.equal((await upload(url, '/web/upload', { 'X-Catbox-Turnstile': 'x'.repeat(2049) })).status, 403);
  const { IMAGES } = await worker.getEnv();
  assert.equal((await IMAGES.list()).objects.length, 0);
  const api = await upload(url, '/upload', { Origin: 'https://example.com' });
  assert.equal(api.status, 201);
  assert.equal(api.headers.get('Access-Control-Allow-Origin'), '*');
  assert.equal((await IMAGES.list()).objects.length, 1);
});

test('partially configured Turnstile fails closed for the website only', async (t) => {
  const server = createTestHarness({ workers: [{
    configPath: 'wrangler.jsonc',
    vars: { TURNSTILE_SITE_KEY: 'test-site-key' },
    secrets: { TURNSTILE_SECRET_KEY: '' },
  }] });
  t.after(() => server.close());
  const { url } = await server.listen();
  const worker = server.getWorker();
  const html = await (await worker.fetch('/')).text();
  assert.match(html, /data-upload-unavailable/);
  assert.doesNotMatch(html, /id="cb-turnstile"/);
  assert.equal((await upload(url, '/web/upload')).status, 503);
  assert.equal((await upload(url, '/upload')).status, 201);
});

test('Siteverify distinguishes acceptance, replay rejection, and service failures', async (t) => {
  const responses = [
    { success: true },
    { success: false, 'error-codes': ['timeout-or-duplicate'] },
    { success: false, 'error-codes': ['internal-error'] },
    { success: 'true' },
  ];
  const fetch = t.mock.method(globalThis, 'fetch', async () => {
    if (responses.length) return Response.json(responses.shift());
    throw new Error('network unavailable');
  });
  assert.equal(await verifyTurnstile('testing', undefined, undefined), 'denied');
  assert.equal(fetch.mock.callCount(), 0);
  assert.equal(await verifyTurnstile('testing', 'fresh', '192.0.2.10'), 'verified');
  const [url, options] = fetch.mock.calls[0].arguments;
  assert.equal(url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
  assert.equal(options.method, 'POST');
  assert.deepEqual(JSON.parse(options.body), { secret: 'testing', response: 'fresh', remoteip: '192.0.2.10' });
  assert.equal(await verifyTurnstile('testing', 'already-spent', undefined), 'denied');
  assert.equal(await verifyTurnstile('testing', 'fresh', undefined), 'unavailable');
  assert.equal(await verifyTurnstile('testing', 'fresh', undefined), 'unavailable');
  assert.equal(await verifyTurnstile('testing', 'fresh', undefined), 'unavailable');
});
