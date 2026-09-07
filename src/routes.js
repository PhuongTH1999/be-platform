import express from 'express';
import { getDB } from './db.js';

const router = express.Router();

// POST /api/packages/sync - Sync/create or update package with version
router.post('/packages/sync', (req, res) => {
  try {
    const { name, description, version, releaseDate, changelog } = req.body;

    if (!name || !version) {
      return res.status(400).json({
        error: 'Missing required fields: name, version'
      });
    }

    const db = getDB();

    // Get or create package
    let pkg = db.prepare('SELECT id FROM packages WHERE name = ?').get(name);

    if (!pkg) {
      const insert = db.prepare('INSERT INTO packages (name, description) VALUES (?, ?)');
      const result = insert.run(name, description || null);
      pkg = { id: result.lastInsertRowid };
    } else {
      // Update package if description provided
      if (description) {
        const update = db.prepare('UPDATE packages SET description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
        update.run(description, pkg.id);
      }
    }

    // Insert or update version
    const existing = db.prepare('SELECT id FROM versions WHERE package_id = ? AND version = ?').get(pkg.id, version);

    if (existing) {
      const update = db.prepare('UPDATE versions SET changelog = ?, release_date = ? WHERE id = ?');
      update.run(changelog || null, releaseDate || null, existing.id);
    } else {
      const insert = db.prepare('INSERT INTO versions (package_id, version, release_date, changelog) VALUES (?, ?, ?, ?)');
      insert.run(pkg.id, version, releaseDate || null, changelog || null);
    }

    res.status(201).json({
      success: true,
      message: 'Package synced successfully',
      package: {
        name,
        version,
        description
      }
    });
  } catch (error) {
    console.error('Sync error:', error);
    res.status(500).json({
      error: error.message
    });
  }
});

// GET /api/packages - List all packages
router.get('/packages', (req, res) => {
  try {
    const db = getDB();
    const packages = db.prepare(`
      SELECT
        p.id,
        p.name,
        p.description,
        p.created_at,
        p.updated_at,
        (SELECT COUNT(*) FROM versions WHERE package_id = p.id) as version_count,
        (SELECT version FROM versions WHERE package_id = p.id ORDER BY release_date DESC, created_at DESC LIMIT 1) as latest_version
      FROM packages p
      ORDER BY p.updated_at DESC
    `).all();

    res.json({
      success: true,
      total: packages.length,
      packages
    });
  } catch (error) {
    console.error('List error:', error);
    res.status(500).json({
      error: error.message
    });
  }
});

// GET /api/packages/:name/versions - Get only versions (must come before GET /api/packages/:name)
router.get('/packages/:scope/:name/versions', (req, res) => {
  try {
    const name = `@${req.params.scope}/${req.params.name}`;
    const db = getDB();

    const pkg = db.prepare('SELECT id FROM packages WHERE name = ?').get(name);

    if (!pkg) {
      return res.status(404).json({
        error: 'Package not found'
      });
    }

    const versions = db.prepare('SELECT version, release_date, changelog, created_at FROM versions WHERE package_id = ? ORDER BY release_date DESC, created_at DESC').all(pkg.id);

    res.json({
      success: true,
      package_name: name,
      total_versions: versions.length,
      versions
    });
  } catch (error) {
    console.error('Versions error:', error);
    res.status(500).json({
      error: error.message
    });
  }
});

// GET /api/packages/:name - Get package details with all versions
router.get('/packages/:scope/:name', (req, res) => {
  try {
    const name = `@${req.params.scope}/${req.params.name}`;
    const db = getDB();

    const pkg = db.prepare('SELECT * FROM packages WHERE name = ?').get(name);

    if (!pkg) {
      return res.status(404).json({
        error: 'Package not found'
      });
    }

    const versions = db.prepare('SELECT id, version, release_date, changelog, created_at FROM versions WHERE package_id = ? ORDER BY release_date DESC, created_at DESC').all(pkg.id);

    res.json({
      success: true,
      package: {
        ...pkg,
        versions
      }
    });
  } catch (error) {
    console.error('Get error:', error);
    res.status(500).json({
      error: error.message
    });
  }
});

// Health check
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString()
  });
});

export default router;
