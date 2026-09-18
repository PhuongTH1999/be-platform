import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { createSduiRouter } from '../cornerstone-package/src/sdui-routes.js';

const schema = { type: 'template_widget', templateType: 'SDUI_WIDGET', data: [{ type: 'text', property: { id: 'title' }, value: 'Xin chào', style: {} }] };
async function start(store) {
  const app = express(); app.use(express.json()); app.use('/sdui', createSduiRouter(store));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}/sdui/templates` };
}

test('SDUI create/list/read/raw/update/delete HTTP contract and validation', async () => {
  const rows = new Map();
  const store = {
    async create(body) { const row = { ...structuredClone(body), id: randomUUID() }; rows.set(row.id, row); return row; },
    async get(id) { return rows.get(id) || null; },
    async list(limit, offset) { return { data: [...rows.values()].slice(offset, offset + limit).map(({ id, name }) => ({ id, name })), count: rows.size }; },
    async update(id, body) { if (!rows.has(id)) return null; const row = { ...body, id }; rows.set(id, row); return row; },
    async remove(id) { const row = rows.get(id); rows.delete(id); return row || null; }
  };
  const { server, url } = await start(store);
  const request = (path, method, body) => fetch(url + path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    for (const body of [null, [], {}, { name: ' ', schema }, { name: 'A', schema: {} }, { name: 'A', schema, id: 'override' }]) {
      assert.equal((await request('', 'POST', body)).status, 400);
    }
    const deep = structuredClone(schema); let cursor = deep;
    for (let i = 0; i < 70; i++) { cursor.nested = {}; cursor = cursor.nested; }
    assert.equal((await request('', 'POST', { name: 'Deep', schema: deep })).status, 400);
    assert.equal(rows.size, 0);
    const create = await request('', 'POST', { name: ' Hello ', schema });
    assert.equal(create.status, 201);
    const { template } = await create.json();
    assert.equal(template.name, 'Hello'); assert.match(create.headers.get('location'), new RegExp(template.id));
    const detail = await (await fetch(url + '/' + template.id)).json();
    assert.deepEqual(detail.template.schema, schema);
    const raw = await fetch(url + '/' + template.id + '/json');
    assert.equal(raw.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await raw.json(), schema);
    const list = await (await fetch(url + '?limit=1&offset=0')).json();
    assert.equal(list.total, 1); assert.equal(list.templates.length, 1); assert.equal(list.templates[0].schema, undefined);
    for (const query of ['limit=0', 'limit=101', 'limit=1.5', 'offset=-1', 'offset=1000001', 'limit=1&limit=2']) {
      assert.equal((await fetch(url + '?' + query)).status, 400);
    }
    const updated = { ...schema, customField: { preserved: true }, data: [] };
    assert.equal((await request('/' + template.id, 'PUT', { name: 'Updated', schema: updated })).status, 200);
    assert.deepEqual(await (await fetch(url + '/' + template.id + '/json')).json(), updated);
    assert.equal((await request('/' + template.id, 'PUT', { name: 'Missing schema' })).status, 400);
    const missing = randomUUID();
    assert.equal((await request('/' + missing, 'PUT', { name: 'X', schema })).status, 404);
    assert.equal((await fetch(url + '/bad-id')).status, 400);
    assert.equal((await fetch(url + '/' + missing + '/json')).status, 404);
    const deleted = await request('/' + template.id, 'DELETE');
    assert.equal(deleted.status, 204); assert.equal(await deleted.text(), '');
    assert.equal((await fetch(url + '/' + template.id)).status, 404);
    assert.equal((await request('/' + template.id, 'DELETE')).status, 404);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('SDUI hides database errors and reports missing migration', async () => {
  let code = 'XX000';
  const { server, url } = await start({ list: async () => { throw { code, message: 'private database details' }; } });
  try {
    let response = await fetch(url); assert.equal(response.status, 500); assert.doesNotMatch(await response.text(), /private/);
    code = 'PGRST205'; response = await fetch(url); assert.equal(response.status, 503);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('Cornerstone mounts SDUI without a new project or changing package routes', async () => {
  const { createApp } = await import('../src/app.js');
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(base + '/api/cornerstone-package/sdui/templates/not-a-uuid')).status, 400);
    assert.equal((await fetch(base + '/api/cornerstone-package/sdui/templates?limit=0')).status, 400);
    assert.equal((await fetch(base + '/api/health')).status, 200);
    const registry = await (await fetch(base)).json();
    assert.deepEqual(registry.projects.map(p => p.name), ['cornerstone-package']);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
