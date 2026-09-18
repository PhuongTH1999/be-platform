import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createRateLimitMiddleware } from '../src/rate-limit.js';

async function serverFor({ dailyStart = 0, minuteStart = 0, dailyLimit = 3, minuteLimit = 2 } = {}) {
  let daily = dailyStart;
  let minute = minuteStart;
  const disabled = [];
  const dynamo = { send: async command => ({
    Attributes: { request_count: { N: String(command.input.Key.bucket.S.startsWith('global#') ? ++daily : ++minute) } }
  }) };
  const lambda = { send: async command => { disabled.push(command.input); return {}; } };
  const app = express();
  app.use(createRateLimitMiddleware({
    tableName: 'test', dailyLimit, minuteLimit, dynamo, lambda,
    functionName: 'be-platform', now: () => new Date('2026-09-18T08:00:00Z')
  }));
  app.get('/', (_req, res) => res.json({ ok: true }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  return { server, disabled, url: `http://127.0.0.1:${server.address().port}` };
}

test('limits each IP per minute', async () => {
  const { server, url } = await serverFor();
  try {
    assert.equal((await fetch(url)).status, 200);
    assert.equal((await fetch(url)).status, 200);
    const blocked = await fetch(url);
    assert.equal(blocked.status, 429);
    assert.equal(blocked.headers.get('retry-after'), '60');
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('disables Lambda when daily maximum is reached', async () => {
  const { server, disabled, url } = await serverFor({ dailyStart: 2, minuteLimit: 10 });
  try {
    const response = await fetch(url);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-ratelimit-daily-remaining'), '0');
    assert.deepEqual(disabled, [{ FunctionName: 'be-platform', ReservedConcurrentExecutions: 0 }]);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('fails closed when the counter is unavailable', async () => {
  const app = express();
  app.use(createRateLimitMiddleware({
    tableName: 'test', dynamo: { send: async () => { throw new Error('database details'); } }
  }));
  app.get('/', (_req, res) => res.json({ ok: true }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}`);
    assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /database details/);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
