import express from 'express';
import cors from 'cors';
import projects from './projects.js';
import { createRateLimitMiddleware } from './rate-limit.js';

export function createApp(projectModules = projects) {
  const app = express();
  // Lambda Function URLs add production CORS headers and answer preflight
  // requests before invoking the function. Keep Express CORS for local use,
  // but do not emit a second Access-Control-Allow-Origin header on AWS.
  if (!process.env.AWS_LAMBDA_FUNCTION_NAME) app.use(cors());
  app.use(createRateLimitMiddleware());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ limit: '1mb', extended: true }));
  app.get('/api/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));
  app.get('/', (_req, res) => res.json({
    name: 'be-platform',
    projects: projectModules.map(({ name, basePath }) => ({ name, basePath }))
  }));
  for (const project of projectModules) app.use(project.basePath, project.router);
  // Preserve existing Cornerstone clients using /api/packages/...
  const cornerstone = projectModules.find(project => project.name === 'cornerstone-package');
  if (cornerstone) app.use('/api', cornerstone.router);
  app.use((_req, res) => res.status(404).json({ error: 'Endpoint not found' }));
  app.use((err, _req, res, _next) => {
    console.error('Request failed:', err.message);
    res.status(err.status || 500).json({ error: err.status === 400 ? 'Invalid request body' : 'Internal server error' });
  });
  return app;
}
