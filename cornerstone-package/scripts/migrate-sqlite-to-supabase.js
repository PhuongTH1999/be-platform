import 'dotenv/config';
import Database from 'better-sqlite3';
import { createClient } from '@supabase/supabase-js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultSqlitePath = path.resolve(scriptDir, '../../data/packages.db');
const sqlitePath = process.env.SQLITE_DB_PATH || defaultSqlitePath;

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const sqlite = new Database(sqlitePath, { readonly: true });

try {
  const packages = sqlite.prepare(
    'SELECT name, description, created_at, updated_at FROM packages ORDER BY id'
  ).all();
  const versions = sqlite.prepare(`
    SELECT p.name AS package_name, v.version, v.release_date, v.changelog, v.created_at
    FROM versions v
    JOIN packages p ON p.id = v.package_id
    ORDER BY v.id
  `).all();

  console.log(`Found ${packages.length} package(s) and ${versions.length} version(s) in SQLite`);

  const packageIds = new Map();
  for (const pkg of packages) {
    const { data, error } = await supabase
      .from('packages')
      .upsert({
        name: pkg.name,
        description: pkg.description,
        created_at: pkg.created_at,
        updated_at: pkg.updated_at
      }, { onConflict: 'name' })
      .select('id, name')
      .single();
    if (error) throw error;
    packageIds.set(data.name, data.id);
  }

  for (const version of versions) {
    const packageId = packageIds.get(version.package_name);
    if (!packageId) {
      throw new Error(`Package mapping not found: ${version.package_name}`);
    }

    const { error } = await supabase
      .from('versions')
      .upsert({
        package_id: packageId,
        version: version.version,
        release_date: version.release_date,
        changelog: version.changelog,
        created_at: version.created_at
      }, { onConflict: 'package_id,version' });
    if (error) throw error;
  }

  const { count: packageCount, error: packageCountError } = await supabase
    .from('packages')
    .select('id', { count: 'exact', head: true });
  if (packageCountError) throw packageCountError;

  const { count: versionCount, error: versionCountError } = await supabase
    .from('versions')
    .select('id', { count: 'exact', head: true });
  if (versionCountError) throw versionCountError;

  console.log(`Supabase totals: ${packageCount} package(s), ${versionCount} version(s)`);
  console.log('Migration completed successfully');
} finally {
  sqlite.close();
}