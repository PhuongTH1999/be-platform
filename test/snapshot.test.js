import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { createSnapshotRouter, MAX_BYTES, TTL_MS } from '../cornerstone-package/src/snapshot-routes.js';
import { createMemorySnapshotStore } from '../cornerstone-package/src/snapshot-store.js';

const layout = { first_loads: [{ id: 'a' }], lazy_loads: [{ id: 'b', data: [] }], extra: { keep: true } };
async function start(store, now) {
  const app = express(); app.use(express.json({ limit: '1mb' })); app.use('/snap', createSnapshotRouter(store, now));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}/snap` };
}
const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('snapshot create/read/metadata round trip', async () => {
  const store = createMemorySnapshotStore();
  const { server, url } = await start(store);
  try {
    const res = await post(url, { layout, meta: { refId: 'r1', blockId: 'b1', platform: 'android', env: 'dev', appVersion: '1.0', ignored: 'x' } });
    assert.equal(res.status, 201);
    const { success, id, expiresAt } = await res.json();
    assert.equal(success, true);
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.ok(Math.abs(new Date(expiresAt) - (Date.now() + TTL_MS)) < 5000);
    const raw = await fetch(`${url}/${id}/json`);
    assert.equal(raw.status, 200);
    assert.equal(raw.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await raw.json(), layout);
    const { snapshot } = await (await fetch(`${url}/${id}`)).json();
    assert.deepEqual(snapshot.meta, { refId: 'r1', blockId: 'b1', platform: 'android', env: 'dev', appVersion: '1.0' });
    assert.equal(snapshot.id, id); assert.ok(snapshot.sizeBytes > 0); assert.ok(snapshot.createdAt); assert.equal(snapshot.layout, undefined);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('snapshot expiry: 410 after TTL, purge removes rows long past expiry', async () => {
  const store = createMemorySnapshotStore();
  let clock = Date.now();
  const { server, url } = await start(store, () => new Date(clock));
  try {
    const { id } = await (await post(url, { layout })).json();
    clock += TTL_MS - 1000;
    assert.equal((await fetch(`${url}/${id}/json`)).status, 200);
    clock += 2000;
    assert.equal((await fetch(`${url}/${id}/json`)).status, 410);
    assert.equal((await fetch(`${url}/${id}`)).status, 410);
    clock += TTL_MS; // a later create purges rows expired for more than a day
    await post(url, { layout });
    assert.equal((await fetch(`${url}/${id}/json`)).status, 404);
    assert.equal(store.rows.size, 1);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('snapshot size limit, shape validation and invalid ids', async () => {
  const store = createMemorySnapshotStore();
  const { server, url } = await start(store);
  try {
    const big = { lazy_loads: [{ blob: 'x'.repeat(MAX_BYTES) }] };
    assert.equal((await post(url, { layout: big })).status, 413);
    for (const body of [null, [], {}, { layout: null }, { layout: [] }, { layout: {} }, { layout: { lazy_loads: {} } }, { layout, meta: [] }, { layout, meta: { refId: 5 } }]) {
      assert.equal((await post(url, body)).status, 400, JSON.stringify(body));
    }
    let deep = {}; const root = { lazy_loads: [deep] };
    for (let i = 0; i < 70; i++) { deep.n = {}; deep = deep.n; }
    assert.equal((await post(url, { layout: root })).status, 400);
    assert.equal(store.rows.size, 0);
    assert.equal((await fetch(`${url}/not-a-uuid`)).status, 400);
    assert.equal((await fetch(`${url}/not-a-uuid/json`)).status, 400);
    assert.equal((await fetch(`${url}/${randomUUID()}/json`)).status, 404);
    assert.equal((await fetch(`${url}/${randomUUID()}`)).status, 404);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('snapshot masking removes sensitive keys at any depth, case-insensitively', async () => {
  const store = createMemorySnapshotStore();
  const { server, url } = await start(store);
  try {
    const dirty = {
      session: 's', userID: 'u',
      first_loads: [{ Phone: '090', keep: 1, nested: { USER_ID: 'x', agent_id: 'y', deeper: [{ SESSION: 'z', ok: true }] } }],
      lazy_loads: [{ phone: '1', title: 'hi' }]
    };
    const { id } = await (await post(url, { layout: dirty })).json();
    const stored = await (await fetch(`${url}/${id}/json`)).json();
    assert.deepEqual(stored, {
      first_loads: [{ keep: 1, nested: { deeper: [{ ok: true }] } }],
      lazy_loads: [{ title: 'hi' }]
    });
    assert.doesNotMatch(JSON.stringify([...store.rows.values()]), /"(session|userID|user_id|agent_id|phone)"/i);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('snapshot storage errors map to 503 / 500 without leaking details', async () => {
  const failing = code => ({ create: async () => { throw Object.assign(new Error('secret detail'), { code }); }, get: async () => { throw Object.assign(new Error('secret detail'), { code }); }, purgeExpired: async () => {} });
  for (const [code, status] of [['42P01', 503], ['XX000', 500]]) {
    const { server, url } = await start(failing(code));
    try {
      const res = await post(url, { layout });
      assert.equal(res.status, status);
      assert.doesNotMatch(await res.text(), /secret/);
      assert.equal((await fetch(`${url}/${randomUUID()}/json`)).status, status);
    } finally { await new Promise(resolve => server.close(resolve)); }
  }
});
