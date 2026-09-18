import express from 'express';
import { getDB } from './db.js';
import sduiRoutes from './sdui-routes.js';

const router = express.Router();
router.use('/sdui', sduiRoutes);

router.post('/packages/sync', async (req, res) => {
  try {
    const { name, description, version, releaseDate, changelog } = req.body;

    if (!name || !version) {
      return res.status(400).json({ error: 'Missing required fields: name, version' });
    }

    const db = getDB();
    const { data: existingPackage, error: packageLookupError } = await db
      .from('packages')
      .select('id')
      .eq('name', name)
      .maybeSingle();
    if (packageLookupError) throw packageLookupError;

    let packageId = existingPackage?.id;
    if (!packageId) {
      const { data: createdPackage, error: packageInsertError } = await db
        .from('packages')
        .insert({ name, description: description || null })
        .select('id')
        .single();
      if (packageInsertError) throw packageInsertError;
      packageId = createdPackage.id;
    } else if (description) {
      const { error: packageUpdateError } = await db
        .from('packages')
        .update({ description, updated_at: new Date().toISOString() })
        .eq('id', packageId);
      if (packageUpdateError) throw packageUpdateError;
    }

    const { data: existingVersion, error: versionLookupError } = await db
      .from('versions')
      .select('id')
      .eq('package_id', packageId)
      .eq('version', version)
      .maybeSingle();
    if (versionLookupError) throw versionLookupError;

    const versionData = {
      package_id: packageId,
      version,
      release_date: releaseDate || null,
      changelog: changelog || null
    };
    const versionQuery = existingVersion
      ? db.from('versions').update(versionData).eq('id', existingVersion.id)
      : db.from('versions').insert(versionData);
    const { error: versionWriteError } = await versionQuery;
    if (versionWriteError) throw versionWriteError;

    res.status(201).json({
      success: true,
      message: 'Package synced successfully',
      package: { name, version, description }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/packages', async (req, res) => {
  try {
    const db = getDB();
    const { data: packages, error: packagesError } = await db
      .from('packages')
      .select('id, name, description, created_at, updated_at')
      .order('updated_at', { ascending: false });
    if (packagesError) throw packagesError;

    const { data: versions, error: versionsError } = await db
      .from('versions')
      .select('package_id, version, release_date');
    if (versionsError) throw versionsError;

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
    const { data: pkg, error } = await getDB()
      .from('packages')
      .select('*')
      .eq('name', name)
      .maybeSingle();
    if (error) throw error;
    if (!pkg) return res.status(404).json({ error: 'Package not found' });
    res.json({ success: true, package: pkg });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/packages/:scope/:name/versions', async (req, res) => {
  try {
    const name = `@${req.params.scope}/${req.params.name}`;
    const db = getDB();
    const { data: pkg, error: packageError } = await db
      .from('packages')
      .select('id')
      .eq('name', name)
      .maybeSingle();
    if (packageError) throw packageError;
    if (!pkg) return res.status(404).json({ error: 'Package not found' });

    const { data: versions, error: versionsError } = await db
      .from('versions')
      .select('version, release_date, changelog, created_at')
      .eq('package_id', pkg.id)
      .order('release_date', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false });
    if (versionsError) throw versionsError;
    res.json({ success: true, package_name: name, total_versions: versions.length, versions });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

export default router;