import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { detectImageFormat } from '../src/image.ts';

const fixture = (name) => readFileSync(new URL('./fixtures/' + name, import.meta.url));

for (const [name, format] of [['long-exif.jpg', 'jpeg'], ['long-comment.gif', 'gif']]) {
  test('detects ' + name + ' even when the first frame follows 4 KiB of metadata', () => {
    const bytes = fixture(name);
    assert.equal(detectImageFormat(bytes.subarray(0, 4096)), null);
    assert.equal(detectImageFormat(bytes), format);
  });
}

test('detects a progressive JPEG', () => {
  assert.equal(detectImageFormat(fixture('progressive.jpg')), 'jpeg');
});

test('reads PNG from a nonzero typed-array offset', () => {
  const bytes = Buffer.concat([Buffer.alloc(7), fixture('plain.png')]);
  assert.equal(detectImageFormat(bytes.subarray(7)), 'png');
});

const ns = 'http://www.w3.org/2000/svg';
const detectText = (xml) => detectImageFormat(new TextEncoder().encode(xml));

test('uses the SVG root namespace regardless of declaration order', () => {
  assert.equal(detectText('<s:svg xmlns:s="' + ns + '" xmlns:x="urn:other"/>'), 'svg');
  assert.equal(detectText('<s:svg xmlns:x="urn:other" xmlns:s="' + ns + '"/>'), 'svg');
  assert.equal(detectText('<?xml version="1.0"?><svg xmlns = "' + ns + '"/>'), 'svg');
});

test('requires a well-formed SVG root in the SVG namespace', () => {
  assert.equal(detectText('<root><svg xmlns="' + ns + '"/></root>'), null);
  assert.equal(detectText('<svg xmlns="' + ns + '">'), null);
});
