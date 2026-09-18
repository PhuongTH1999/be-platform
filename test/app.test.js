import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createApp } from '../src/app.js';

test('project isolation, legacy routes, health and request errors', async () => {
  const cornerstone = express.Router();
  cornerstone.get('/packages', (_req, res) => res.json({ project: 'cornerstone' }));
  const second = express.Router();
  second.get('/packages', (_req, res) => res.json({ project: 'second' }));
  const server = createApp([
    { name: 'cornerstone-package', basePath: '/api/cornerstone-package', router: cornerstone },
    { name: 'second', basePath: '/api/second', router: second }
  ]).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const path of ['/api/packages', '/api/cornerstone-package/packages']) {
      assert.deepEqual(await (await fetch(base + path)).json(), { project: 'cornerstone' });
    }
    assert.deepEqual(await (await fetch(base + '/api/second/packages')).json(), { project: 'second' });
    assert.equal((await (await fetch(base + '/api/health')).json()).status, 'ok');
    assert.equal((await fetch(base + '/missing')).status, 404);
    assert.equal((await (await fetch(base)).json()).projects.length, 2);
    assert.equal((await fetch(base + '/api/packages/sync', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{'
    })).status, 400);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
