import { getDB } from './db.js';

const table = 'cornerstone_layout_snapshots';
const fields = 'id, layout, meta, size_bytes, created_at, expires_at';
async function result(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export const snapshotStore = {
  async create(row) {
    return result(getDB().from(table).insert(row).select(fields).single());
  },
  async get(id) {
    return result(getDB().from(table).select(fields).eq('id', id).maybeSingle());
  },
  // Rows are kept for 1 day after expiry so readers get 410 rather than 404 in that window.
  async purgeExpired(olderThan) {
    await result(getDB().from(table).delete().lt('expires_at', olderThan.toISOString()));
  }
};

// In-memory store for tests and local experiments without Supabase.
export function createMemorySnapshotStore() {
  const rows = new Map();
  return {
    rows,
    async create(row) { const copy = { created_at: new Date().toISOString(), ...structuredClone(row) }; rows.set(copy.id, copy); return structuredClone(copy); },
    async get(id) { return rows.has(id) ? structuredClone(rows.get(id)) : null; },
    async purgeExpired(olderThan) {
      for (const [id, row] of rows) if (new Date(row.expires_at) < olderThan) rows.delete(id);
    }
  };
}
