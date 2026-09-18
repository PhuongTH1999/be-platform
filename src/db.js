import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';

let db;

export function initDB(env = process.env) {
  if (db) return db;
  const key = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!env.SUPABASE_URL || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) are required');
  }
  db = createClient(env.SUPABASE_URL, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: WebSocket }
  });
  return db;
}

export function getDB() {
  if (!db) throw new Error('Database not initialized. Call initDB() first.');
  return db;
}

export async function closeDB() {
  if (db) await db.removeAllChannels();
  db = undefined;
}
