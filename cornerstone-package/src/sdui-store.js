import { getDB } from './db.js';

const table = 'cornerstone_sdui_templates';
// Filled by a trigger on every insert / update of `table` (migrations/002).
const versions = 'cornerstone_sdui_template_versions';
const versionFields = 'version, name, change_summary, created_by, created_at';
const fields = 'id, name, schema, created_at, updated_at';
async function result(query) {
  const { data, error, count } = await query;
  if (error) throw error;
  return { data, count };
}
export const templateStore = {
  async list(limit, offset) {
    return result(getDB().from(table)
      .select('id, name, created_at, updated_at', { count: 'exact' })
      .order('created_at', { ascending: false }).order('id')
      .range(offset, offset + limit - 1));
  },
  async get(id) {
    return (await result(getDB().from(table).select(fields).eq('id', id).maybeSingle())).data;
  },
  async create(value) {
    return (await result(getDB().from(table).insert(value).select(fields).single())).data;
  },
  async update(id, value) {
    return (await result(getDB().from(table).update(value).eq('id', id).select(fields).maybeSingle())).data;
  },
  async remove(id) {
    return (await result(getDB().from(table).delete().eq('id', id).select('id').maybeSingle())).data;
  },
  async exists(id) {
    return !!(await result(getDB().from(table).select('id').eq('id', id).maybeSingle())).data;
  },
  async listVersions(id, limit, before) {
    let query = getDB().from(versions).select(versionFields, { count: 'exact' }).eq('template_id', id);
    if (before) query = query.lt('version', before);
    return result(query.order('version', { ascending: false }).limit(limit));
  },
  async getVersion(id, version) {
    return (await result(getDB().from(versions).select(`${versionFields}, schema`).eq('template_id', id).eq('version', version).maybeSingle())).data;
  }
};
