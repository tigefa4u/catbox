import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { unstable_dev } from 'wrangler';

const fixture = (name) => readFile(new URL(name, import.meta.url));

test('upload retries reuse one R2 object and keep distinct uploads separate', async (t) => {
  const worker = await unstable_dev('src/index.ts', {
    logLevel: 'error', experimental: { disableExperimentalWarning: true },
  });
  t.after(() => worker.stop());
  const png = await fixture('./fixtures/plain.png');
  const jpeg = await fixture('./fixtures/progressive.jpg');
  const jpegWithExif = await fixture('./fixtures/long-exif.jpg');

  function upload(bytes, uploadToken) {
    const body = new FormData();
    body.append('fileToUpload', new Blob([bytes]), 'image');
    const headers = { Accept: 'application/json' };
    if (uploadToken !== undefined) headers['X-Catbox-Upload-Token'] = uploadToken;
    return fetch('http://' + worker.address + ':' + worker.port + '/upload', { method: 'POST', headers, body });
  }

  const token = randomUUID();
  const replies = await Promise.all([upload(png, token), upload(png, token)]);
assert.ok(replies.every((r) => r.ok), (await Promise.all(replies.map((r) => r.clone().text()))).join("; "));
  assert.deepEqual(replies.map((r) => r.status).sort(), [200, 201]);
  const [first, retry] = await Promise.all(replies.map((r) => r.json()));
  assert.equal(retry.url, first.url);
  const imagePath = new URL(first.url).pathname;
  assert.match(imagePath, /^\/[a-f0-9]{32}\.png$/);
  const image = await worker.fetch(imagePath);
  assert.equal(image.status, 200);
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), png);

  const differentToken = await upload(png, randomUUID());
  assert.equal(differentToken.status, 201);
  assert.notEqual((await differentToken.json()).url, first.url);
  const firstJpeg = await upload(jpeg, token);
  assert.equal(firstJpeg.status, 201);
  const differentBytes = await upload(jpegWithExif, token);
  assert.equal(differentBytes.status, 201);
  assert.notEqual((await differentBytes.json()).url, (await firstJpeg.json()).url);
  const noToken = await upload(png);
  assert.equal(noToken.status, 201);
  assert.match(new URL((await noToken.json()).url).pathname, /^\/[a-z0-9]{11}\.png$/);
  assert.equal((await upload(png, 'not-a-uuid')).status, 400);
});
