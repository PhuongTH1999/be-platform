import { getDB } from './db.js';

const legacyVersionFields = 'version, release_date, changelog, created_at';
// Added by migrations/004_add_version_release_notes.sql.
export const versionFields = `${legacyVersionFields}, release_type, summary, service_action, notes_updated_at, notes_updated_by`;
export const emptyNotes = { release_type: null, summary: null, service_action: null, notes_updated_at: null, notes_updated_by: null };
// Missing column on select (42703) or write (PGRST204): migration 004 has not been applied.
export const isMissingColumn = error => ['42703', 'PGRST204'].includes(error?.code);

async function result(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export function createPackageStore(db = getDB) {
  return {
    async findPackage(name, fields = 'id') {
      return result(db().from('packages').select(fields).eq('name', name).maybeSingle());
    },
    async createPackage(row) {
      return (await result(db().from('packages').insert(row).select('id').single())).id;
    },
    async updatePackage(id, row) {
      await result(db().from('packages').update(row).eq('id', id));
    },
    async listPackages() {
      return result(db().from('packages')
        .select('id, name, description, created_at, updated_at')
        .order('updated_at', { ascending: false }));
    },
    async listVersionSummaries() {
      return result(db().from('versions').select('package_id, version, release_date'));
    },
    async findVersion(packageId, version) {
      return result(db().from('versions').select('id').eq('package_id', packageId).eq('version', version).maybeSingle());
    },
    async insertVersion(row) {
      await result(db().from('versions').insert(row));
    },
    async updateVersion(id, row) {
      await result(db().from('versions').update(row).eq('id', id));
    },
    // Sync may supply a release type, but an edited (or earlier) value always wins.
    async fillReleaseType(id, releaseType) {
      await result(db().from('versions').update({ release_type: releaseType }).eq('id', id).is('release_type', null));
    },
    async listVersions(packageId) {
      const query = fields => db().from('versions')
        .select(fields)
        .eq('package_id', packageId)
        .order('release_date', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false });
      try {
        return await result(query(versionFields));
      } catch (error) {
        // Keep the read path working between deploying this code and applying migration 004.
        if (!isMissingColumn(error)) throw error;
        return (await result(query(legacyVersionFields))).map(row => ({ ...row, ...emptyNotes }));
      }
    },
    async updateNotes(packageId, version, patch) {
      return result(db().from('versions').update(patch)
        .eq('package_id', packageId).eq('version', version)
        .select(versionFields).maybeSingle());
    }
  };
}

export const packageStore = createPackageStore();
