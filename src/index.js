import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { initDB, closeDB } from './db.js';
import projects from './projects.js';

dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });
const port = Number(process.env.PORT || 3000);
let server;
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  const timeout = setTimeout(() => process.exit(1), 10000);
  timeout.unref();
  if (server) await new Promise(resolve => server.close(resolve));
  await closeDB();
  clearTimeout(timeout);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

try {
  const db = initDB();
  for (const project of projects) await project.checkDatabase?.(db);
  server = createApp().listen(port, '0.0.0.0', () => console.log(`be-platform listening on port ${port}`));
  server.on('error', error => { console.error('Server failed:', error.message); process.exit(1); });
} catch (error) {
  console.error('Failed to start server:', error.message);
  await closeDB();
  process.exitCode = 1;
}
