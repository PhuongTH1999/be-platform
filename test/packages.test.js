import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createPackageRouter, MAX_NOTE_BYTES } from '../cornerstone-package/src/routes.js';
import { createPackageStore, emptyNotes } from '../cornerstone-package/src/package-store.js';
import { createApp } from '../src/app.js';

const noteKeys = Object.keys(emptyNotes);
const pick = (row, keys) => Object.fromEntries(keys.map(key => [key, row[key] ?? null]));

function memoryStore() {
  const packages = []; const versions = [];
  const view = row => ({ ...emptyNotes, ...pick(row, ['version', 'release_date', 'changelog', 'created_at', ...noteKeys]) });
  return {
    packages, versions,
    async findPackage(name) { return packages.find(pkg => pkg.name === name) || null; },
    async createPackage(row) { const pkg = { id: packages.length + 1, ...row }; packages.push(pkg); return pkg.id; },
    async updatePackage(id, row) { Object.assign(packages.find(pkg => pkg.id === id), row); },
    async listPackages() { return packages; },
    async listVersionSummaries() { return versions; },
    async findVersion(packageId, version) { return versions.find(row => row.package_id === packageId && row.version === version) || null; },
    async insertVersion(row) { versions.push({ ...emptyNotes, id: versions.length + 1, created_at: new Date().toISOString(), ...row }); },
    async updateVersion(id, row) { Object.assign(versions.find(item => item.id === id), row); },
    async fillReleaseType(id, releaseType) { const row = versions.find(item => item.id === id); if (row.release_type === null) row.release_type = releaseType; },
    async listVersions(packageId) { return versions.filter(row => row.package_id === packageId).map(view); },
    async updateNotes(packageId, version, patch) {
      const row = versions.find(item => item.package_id === packageId && item.version === version);
      if (!row) return null;
      Object.assign(row, patch);
      return view(row);
    }
  };
}

async function start(store, now) {
  const app = express(); app.use(express.json({ limit: '1mb' })); app.use('/api', createPackageRouter(store, now));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}/api/packages` };
}
const send = (url, method, body) => fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const versionsUrl = url => `${url}/momo-platform/native-widget/versions`;
const legacyPayload = { name: '@momo-platform/native-widget', description: 'Native widget', version: '1.1.0-caching.ios.1', releaseDate: '2026-11-01T00:00:00.000Z', changelog: '- cache' };

test('sync keeps the legacy payload working and GET returns null release notes', async () => {
  const store = memoryStore();
  const { server, url } = await start(store);
  try {
    const res = await send(`${url}/sync`, 'POST', legacyPayload);
    assert.equal(res.status, 201);
    assert.deepEqual(await res.json(), { success: true, message: 'Package synced successfully', package: { name: legacyPayload.name, version: legacyPayload.version, description: 'Native widget' } });
    assert.equal((await send(`${url}/sync`, 'POST', { name: 'x' })).status, 400);
    const body = await (await fetch(versionsUrl(url))).json();
    assert.equal(body.total_versions, 1);
    const [item] = body.versions;
    assert.deepEqual(pick(item, ['version', 'release_date', 'changelog']), { version: legacyPayload.version, release_date: legacyPayload.releaseDate, changelog: '- cache' });
    for (const key of noteKeys) assert.ok(Object.hasOwn(item, key) && item[key] === null, key);
    assert.equal((await fetch(`${url}/momo-platform/missing/versions`)).status, 404);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('PATCH edits notes, clears with null or blank, stores markdown verbatim', async () => {
  const store = memoryStore();
  const clock = new Date('2026-11-20T03:00:00.000Z');
  const { server, url } = await start(store, () => clock);
  const versionUrl = `${versionsUrl(url)}/${encodeURIComponent(legacyPayload.version)}`;
  try {
    await send(`${url}/sync`, 'POST', legacyPayload);
    const markdown = '  ```kotlin\nval x = 1\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n';
    const res = await send(versionUrl, 'PATCH', { release_type: 'feature', summary: markdown, service_action: 'Bump to 1.1.0', updated_by: '  phuong  ' });
    assert.equal(res.status, 200);
    const { success, package_name, version } = await res.json();
    assert.equal(success, true); assert.equal(package_name, '@momo-platform/native-widget');
    assert.deepEqual(pick(version, ['version', ...noteKeys]), {
      version: legacyPayload.version, release_type: 'feature', summary: markdown, service_action: 'Bump to 1.1.0',
      notes_updated_at: clock.toISOString(), notes_updated_by: 'phuong'
    });
    assert.equal(version.changelog, '- cache');

    // Absent keys stay unchanged; null and whitespace clear; updated_by is overwritten on every PATCH.
    const cleared = (await (await send(versionUrl, 'PATCH', { summary: ' \n ', release_type: null })).json()).version;
    assert.deepEqual(pick(cleared, ['release_type', 'summary', 'service_action', 'notes_updated_by']), { release_type: null, summary: null, service_action: 'Bump to 1.1.0', notes_updated_by: null });
    assert.equal((await (await send(versionUrl, 'PATCH', { service_action: null, release_type: '' })).json()).version.service_action, null);

    const listed = (await (await fetch(versionsUrl(url))).json()).versions[0];
    assert.equal(listed.notes_updated_at, clock.toISOString());
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('PATCH validation, size limit and not-found errors', async () => {
  const store = memoryStore();
  const { server, url } = await start(store);
  const versionUrl = `${versionsUrl(url)}/${legacyPayload.version}`;
  try {
    await send(`${url}/sync`, 'POST', legacyPayload);
    for (const body of [[], {}, { updated_by: 'a' }, { release_type: 'major' }, { release_type: 1 }, { summary: 5 }, { service_action: ['x'] }, { summary: 'a', updated_by: 7 }, { summary: 'a', changelog: 'x' }, { summary: 'a', version: '9.9.9' }]) {
      const res = await send(versionUrl, 'PATCH', body);
      assert.equal(res.status, 400, JSON.stringify(body));
      const json = await res.json();
      assert.equal(json.success, false); assert.equal(typeof json.error, 'string');
    }
    const big = await send(versionUrl, 'PATCH', { summary: 'é'.repeat(MAX_NOTE_BYTES / 2 + 1) });
    assert.equal(big.status, 413);
    assert.match((await big.json()).error, /summary is larger than 256 KB/);
    assert.equal((await send(versionUrl, 'PATCH', { summary: 'x'.repeat(MAX_NOTE_BYTES) })).status, 200);
    assert.equal((await send(`${versionsUrl(url)}/bad%20version`, 'PATCH', { summary: 'a' })).status, 400);
    const missingVersion = await send(`${versionsUrl(url)}/9.9.9`, 'PATCH', { summary: 'a' });
    assert.equal(missingVersion.status, 404);
    assert.deepEqual(await missingVersion.json(), { success: false, error: 'Version not found' });
    const missingPackage = await send(`${url}/momo-platform/missing/versions/1.0.0`, 'PATCH', { summary: 'a' });
    assert.equal(missingPackage.status, 404);
    assert.deepEqual(await missingPackage.json(), { success: false, error: 'Package not found' });
    assert.equal(store.versions.length, 1);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('re-sync never overwrites edited notes; releaseType only fills an empty release_type', async () => {
  const store = memoryStore();
  const { server, url } = await start(store);
  const versionUrl = `${versionsUrl(url)}/${legacyPayload.version}`;
  try {
    await send(`${url}/sync`, 'POST', { ...legacyPayload, releaseType: 'hotfix' });
    assert.equal(store.versions[0].release_type, 'hotfix');
    await send(versionUrl, 'PATCH', { release_type: 'feature', summary: 'Edited', service_action: 'Upgrade' });
    const res = await send(`${url}/sync`, 'POST', { ...legacyPayload, changelog: '- cache v2', releaseType: 'hotfix' });
    assert.equal(res.status, 201);
    assert.deepEqual(pick(store.versions[0], ['changelog', 'release_type', 'summary', 'service_action']), { changelog: '- cache v2', release_type: 'feature', summary: 'Edited', service_action: 'Upgrade' });
    await send(`${url}/sync`, 'POST', { ...legacyPayload, version: '1.1.1' });
    assert.equal(store.versions[1].release_type, null);
    await send(`${url}/sync`, 'POST', { ...legacyPayload, version: '1.1.1', releaseType: 'hotfix' });
    assert.equal(store.versions[1].release_type, 'hotfix');
    assert.equal((await send(`${url}/sync`, 'POST', { ...legacyPayload, releaseType: 'major' })).status, 400);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('503 when migration 004 is missing on PATCH and on sync with releaseType', async () => {
  const missing = Object.assign(new Error('column versions.summary does not exist'), { code: '42703' });
  const store = { ...memoryStore(), async findPackage() { return { id: 1 }; }, async updatePackage() {}, async findVersion() { return null; }, async updateNotes() { throw missing; }, async insertVersion(row) { if (row.release_type) throw Object.assign(new Error('x'), { code: 'PGRST204' }); } };
  const { server, url } = await start(store);
  try {
    const res = await send(`${versionsUrl(url)}/1.0.0`, 'PATCH', { summary: 'a' });
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { success: false, error: 'Release notes storage is not initialized' });
    assert.equal((await send(`${url}/sync`, 'POST', { ...legacyPayload, releaseType: 'hotfix' })).status, 503);
    assert.equal((await send(`${url}/sync`, 'POST', legacyPayload)).status, 201);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

// Records the Supabase query chain and answers with `respond(call)`.
function fakeDB(respond) {
  const calls = [];
  const db = {
    from(table) {
      const call = { table, ops: [] }; calls.push(call);
      const builder = new Proxy({}, { get(_target, prop) {
        if (prop === 'then') return (resolve, reject) => Promise.resolve(respond(call)).then(resolve, reject);
        return (...args) => { call.ops.push([prop, ...args]); return builder; };
      } });
      return builder;
    }
  };
  return { calls, db: () => db };
}

test('Supabase store: legacy column fallback, conditional release_type and scoped notes update', async () => {
  const legacyRow = { version: '1.0.0', release_date: null, changelog: 'c', created_at: 't' };
  const fake = fakeDB(call => {
    const fields = call.ops.find(([op]) => op === 'select')?.[1] || '';
    return fields.includes('summary') ? { data: null, error: { code: '42703', message: 'column does not exist' } } : { data: [legacyRow], error: null };
  });
  const store = createPackageStore(fake.db);
  assert.deepEqual(await store.listVersions(7), [{ ...legacyRow, ...emptyNotes }]);
  assert.equal(fake.calls.length, 2);

  const broken = createPackageStore(fakeDB(() => ({ data: null, error: { code: '42501', message: 'denied' } })).db);
  await assert.rejects(broken.listVersions(7), { code: '42501' });

  const writes = fakeDB(() => ({ data: { version: '1.0.0' }, error: null }));
  const writer = createPackageStore(writes.db);
  await writer.fillReleaseType(3, 'hotfix');
  assert.deepEqual(writes.calls[0].ops, [['update', { release_type: 'hotfix' }], ['eq', 'id', 3], ['is', 'release_type', null]]);
  await writer.updateNotes(7, '1.0.0', { summary: 's' });
  assert.deepEqual(writes.calls[1].ops.slice(0, 3), [['update', { summary: 's' }], ['eq', 'package_id', 7], ['eq', 'version', '1.0.0']]);
  await writer.updateVersion(3, { changelog: 'x' });
  assert.deepEqual(writes.calls[2].ops, [['update', { changelog: 'x' }], ['eq', 'id', 3]]);
});

test('shared app answers an oversized body with 413 and a clear message', async () => {
  const server = createApp([{ name: 'cornerstone-package', basePath: '/api/cornerstone-package', router: createPackageRouter(memoryStore()) }]).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const res = await send(`http://127.0.0.1:${server.address().port}/api/packages/momo-platform/native-widget/versions/1.0.0`, 'PATCH', { summary: 'x'.repeat(1100000) });
    assert.equal(res.status, 413);
    assert.deepEqual(await res.json(), { error: 'Request body too large' });
  } finally { await new Promise(resolve => server.close(resolve)); }
});
