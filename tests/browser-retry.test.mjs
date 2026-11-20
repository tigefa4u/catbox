import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

const appSource = await readFile(new URL('../public/js/app.js', import.meta.url), 'utf8');

function extractFunction(source, name) {
  const match = source.match(new RegExp('function ' + name + '\\s*\\([^)]*\\)\\s*\\{'));
  assert.ok(match, 'expected function ' + name + ' in browser bundle');

  const start = match.index;
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index++) {
    if (source[index] === '{') depth++;
    if (source[index] === '}') {
      depth--;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }

  assert.fail('unterminated function ' + name);
}

test('browser upload stops after five requests and keeps Retry-After pause for queued files', () => {
  const now = 1_000;
  const queuePumpPauseChecks = [];
  let pauseTickerCalls = 0;
  let completed = 0;
  const context = {
    MAX_ATTEMPTS: 5,
    pausedUntil: 0,
    rateLimitedUntil: 0,
    Date: { now: () => now },
    Math,
  };
  context.startPauseTicker = () => {
    pauseTickerCalls++;
  };
  context.completeItem = () => {
    completed++;
    // completeItem pumps the queue; it must observe the shared pause.
    queuePumpPauseChecks.push(context.pausedUntil > now);
  };
  context.failItem = (item, message) => {
    item.status = 'error';
    item.error = message;
    context.completeItem(item);
  };
  const retryLater = vm.runInNewContext(
    '(' + extractFunction(appSource, 'retryLater') + ')',
    context,
  );

  const item = { attempts: 0, status: 'uploading', progress: 0, error: '', note: '' };
  let requestsSent = 0;

  // Each invocation represents one completed HTTP 429 response.
  for (let request = 0; request < 5; request++) {
    requestsSent++;
    retryLater.call(context, item, 10_000, 'Rate limited.', true);
  }

  assert.equal(requestsSent, 5, 'no sixth upload request should be scheduled');
  assert.equal(item.attempts, 5);
  assert.equal(item.status, 'error', 'the exhausted item should fail');
  assert.match(item.error, /Gave up after 5 attempts/);
  assert.equal(completed, 5);
  assert.deepEqual(queuePumpPauseChecks, [true, true, true, true, true]);
  assert.equal(context.pausedUntil, now + 10_000);
  assert.equal(context.rateLimitedUntil, now + 10_000);
  assert.equal(pauseTickerCalls, 5);
});
