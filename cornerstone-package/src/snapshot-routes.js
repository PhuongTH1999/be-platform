import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { snapshotStore } from './snapshot-store.js';

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const MAX_BYTES = 256 * 1024;
export const TTL_MS = 24 * 60 * 60 * 1000;
const PURGE_AFTER_MS = 24 * 60 * 60 * 1000;
const MAX_DEPTH = 64;
const META_KEYS = ['refId', 'blockId', 'platform', 'env', 'appVersion'];
// Defense in depth: the client should not send these, the server removes them anyway.
const SENSITIVE_KEYS = new Set(['session', 'userid', 'user_id', 'agent_id', 'phone']);

// Returns a copy without sensitive keys at any depth; throws TooDeep past MAX_DEPTH.
class TooDeep extends Error {}
function sanitize(value, depth = 0) {
  if (depth > MAX_DEPTH) throw new TooDeep();
  if (Array.isArray(value)) return value.map(item => sanitize(item, depth + 1));
  if (!isObject(value)) return value;
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (!SENSITIVE_KEYS.has(key.toLowerCase())) out[key] = sanitize(child, depth + 1);
  }
  return out;
}

function validate(body) {
  if (!isObject(body)) return 'Body must be an object containing layout';
  if (!isObject(body.layout) || !Array.isArray(body.layout.lazy_loads)) return 'layout must be an object with a lazy_loads array';
  if (body.meta != null) {
    if (!isObject(body.meta)) return 'meta must be an object';
    for (const key of META_KEYS) {
      const value = body.meta[key];
      if (value != null && (typeof value !== 'string' || value.length > 100)) return `meta.${key} must be a string of at most 100 characters`;
    }
  }
  return null;
}

const metaOf = meta => Object.fromEntries(META_KEYS.filter(key => typeof meta?.[key] === 'string').map(key => [key, meta[key]]));
const view = row => ({ id: row.id, meta: row.meta, createdAt: row.created_at, expiresAt: row.expires_at, sizeBytes: row.size_bytes });

export function createSnapshotRouter(store = snapshotStore, now = () => new Date()) {
  const router = Router();
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.param('id', (req, res, next, id) => {
    if (!uuid.test(id)) return res.status(400).json({ error: 'Invalid snapshot UUID' });
    next();
  });
  const handle = fn => async (req, res) => {
    try { await fn(req, res); }
    catch (error) {
      console.error('Layout snapshot request failed:', error.code || 'database_error');
      // Missing table (migration 003 not applied).
      if (['42P01', 'PGRST205'].includes(error.code)) {
        return res.status(503).json({ error: 'Layout snapshot storage is not initialized' });
      }
      res.status(500).json({ error: 'Unable to process layout snapshot request' });
    }
  };
  // 404 when missing, 410 when expired; otherwise the row.
  const load = async (req, res) => {
    const row = await store.get(req.params.id);
    if (!row) { res.status(404).json({ error: 'Snapshot not found' }); return null; }
    if (new Date(row.expires_at) <= now()) { res.status(410).json({ error: 'Snapshot expired' }); return null; }
    return row;
  };

  router.post('/', handle(async (req, res) => {
    const error = validate(req.body);
    if (error) return res.status(400).json({ error });
    const sizeBytes = Buffer.byteLength(JSON.stringify(req.body));
    if (sizeBytes > MAX_BYTES) return res.status(413).json({ error: `Body exceeds ${MAX_BYTES} bytes` });
    let layout;
    try { layout = sanitize(req.body.layout); }
    catch (e) {
      if (e instanceof TooDeep) return res.status(400).json({ error: `layout exceeds maximum nesting depth of ${MAX_DEPTH}` });
      throw e;
    }
    const created = now();
    const row = await store.create({
      id: randomUUID(),
      layout,
      meta: metaOf(req.body.meta),
      size_bytes: Buffer.byteLength(JSON.stringify(layout)),
      created_at: created.toISOString(),
      expires_at: new Date(created.getTime() + TTL_MS).toISOString()
    });
    // Best-effort cleanup; a failure must not fail the create.
    await store.purgeExpired(new Date(created.getTime() - PURGE_AFTER_MS)).catch(e => console.error('Layout snapshot purge failed:', e.code || 'database_error'));
    res.location(`${req.baseUrl}/${row.id}/json`).status(201).json({ success: true, id: row.id, expiresAt: row.expires_at });
  }));
  router.get('/:id/json', handle(async (req, res) => {
    const row = await load(req, res);
    if (row) res.json(row.layout);
  }));
  router.get('/:id', handle(async (req, res) => {
    const row = await load(req, res);
    if (row) res.json({ success: true, snapshot: view(row) });
  }));
  return router;
}

export default createSnapshotRouter();
