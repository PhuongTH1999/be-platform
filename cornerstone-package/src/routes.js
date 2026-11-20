import express from 'express';
import { packageStore, isMissingColumn } from './package-store.js';
import sduiRoutes from './sdui-routes.js';
import snapshotRoutes from './snapshot-routes.js';

export const RELEASE_TYPES = ['feature', 'hotfix'];
export const MAX_NOTE_BYTES = 256 * 1024;
const noteKeys = ['release_type', 'summary', 'service_action'];
const patchKeys = [...noteKeys, 'updated_by'];
const versionPattern = /^[0-9A-Za-z.+_-]{1,100}$/;
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const has = (body, key) => Object.hasOwn(body, key);

// Returns { patch } or { status, error }. Absent keys stay unchanged; null, '' and whitespace-only clear a field.
// Markdown is stored verbatim: trimming would break code fences and tables.
function parseNotes(body, now) {
  if (!isObject(body)) return { status: 400, error: 'Body must be a JSON object' };
  const unknown = Object.keys(body).find(key => !patchKeys.includes(key));
  if (unknown) return { status: 400, error: `Unknown field: ${unknown}. Accepted: ${patchKeys.join(', ')}` };
  if (!noteKeys.some(key => has(body, key))) return { status: 400, error: `Provide at least one of ${noteKeys.join(', ')}` };
  const patch = {};
  if (has(body, 'release_type')) {
    const value = body.release_type;
    if (value !== null && value !== '' && !RELEASE_TYPES.includes(value)) {
      return { status: 400, error: "release_type must be 'feature', 'hotfix' or null" };
    }
    patch.release_type = value || null;
  }
  for (const key of ['summary', 'service_action']) {
    if (!has(body, key)) continue;
    const value = body[key];
    if (value !== null && typeof value !== 'string') return { status: 400, error: `${key} must be a string or null` };
    if (value !== null && Buffer.byteLength(value, 'utf8') > MAX_NOTE_BYTES) {
      return { status: 413, error: `${key} is larger than ${MAX_NOTE_BYTES / 1024} KB` };
    }
    patch[key] = value !== null && value.trim() ? value : null;
  }
  const author = body.updated_by;
  if (author != null && typeof author !== 'string') return { status: 400, error: 'updated_by must be a string or null' };
  // `updated_by` is self-reported by the client: the API has no auth yet.
  patch.notes_updated_by = typeof author === 'string' && author.trim() ? author.trim().slice(0, 200) : null;
  patch.notes_updated_at = now().toISOString();
  return { patch };
}

export function createPackageRouter(store = packageStore, now = () => new Date()) {
  const router = express.Router();

  router.post('/packages/sync', async (req, res) => {
    try {
      const { name, description, version, releaseDate, changelog, releaseType } = req.body;

      if (!name || !version) {
        return res.status(400).json({ error: 'Missing required fields: name, version' });
      }
      if (releaseType != null && releaseType !== '' && !RELEASE_TYPES.includes(releaseType)) {
        return res.status(400).json({ error: "releaseType must be 'feature' or 'hotfix'" });
      }

      const existingPackage = await store.findPackage(name);
      let packageId = existingPackage?.id;
      if (!packageId) {
        packageId = await store.createPackage({ name, description: description || null });
      } else if (description) {
        await store.updatePackage(packageId, { description, updated_at: new Date().toISOString() });
      }

      const existingVersion = await store.findVersion(packageId, version);
      // Only the synced fields: release notes edited in the tool are never overwritten.
      const versionData = {
        package_id: packageId,
        version,
        release_date: releaseDate || null,
        changelog: changelog || null
      };
      if (existingVersion) {
        await store.updateVersion(existingVersion.id, versionData);
        if (releaseType) await store.fillReleaseType(existingVersion.id, releaseType);
      } else {
        await store.insertVersion(releaseType ? { ...versionData, release_type: releaseType } : versionData);
      }

      res.status(201).json({
        success: true,
        message: 'Package synced successfully',
        package: { name, version, description }
      });
    } catch (error) {
      if (isMissingColumn(error)) return res.status(503).json({ error: 'Release notes storage is not initialized' });
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/packages', async (req, res) => {
    try {
      const packages = await store.listPackages();
      const versions = await store.listVersionSummaries();

      const packageSummaries = packages.map((pkg) => {
        const packageVersions = versions.filter((item) => item.package_id === pkg.id);
        const latest = [...packageVersions].sort((a, b) =>
          new Date(b.release_date || 0) - new Date(a.release_date || 0)
        )[0];
        return {
          ...pkg,
          version_count: packageVersions.length,
          latest_version: latest?.version || null
        };
      });
      res.json({ success: true, total: packageSummaries.length, packages: packageSummaries });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/packages/:scope/:name', async (req, res) => {
    try {
      const name = `@${req.params.scope}/${req.params.name}`;
      const pkg = await store.findPackage(name, '*');
      if (!pkg) return res.status(404).json({ error: 'Package not found' });
      res.json({ success: true, package: pkg });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/packages/:scope/:name/versions', async (req, res) => {
    try {
      const name = `@${req.params.scope}/${req.params.name}`;
      const pkg = await store.findPackage(name);
      if (!pkg) return res.status(404).json({ error: 'Package not found' });

      const versions = await store.listVersions(pkg.id);
      res.json({ success: true, package_name: name, total_versions: versions.length, versions });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Release notes edited from the Cornerstone tool. No auth yet: anyone who can reach the API can edit.
  router.patch('/packages/:scope/:name/versions/:version', async (req, res) => {
    try {
      if (!versionPattern.test(req.params.version)) {
        return res.status(400).json({ success: false, error: 'Invalid version' });
      }
      const { patch, status, error } = parseNotes(req.body, now);
      if (error) return res.status(status).json({ success: false, error });

      const name = `@${req.params.scope}/${req.params.name}`;
      const pkg = await store.findPackage(name);
      if (!pkg) return res.status(404).json({ success: false, error: 'Package not found' });

      const version = await store.updateNotes(pkg.id, req.params.version, patch);
      if (!version) return res.status(404).json({ success: false, error: 'Version not found' });
      res.json({ success: true, package_name: name, version });
    } catch (error) {
      console.error('Release notes update failed:', error.code || 'database_error');
      if (isMissingColumn(error)) {
        return res.status(503).json({ success: false, error: 'Release notes storage is not initialized' });
      }
      res.status(500).json({ success: false, error: 'Unable to update release notes' });
    }
  });

  return router;
}

const router = express.Router();
router.use('/sdui', sduiRoutes);
router.use('/layout-snapshots', snapshotRoutes);
router.use(createPackageRouter());

router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

export default router;
