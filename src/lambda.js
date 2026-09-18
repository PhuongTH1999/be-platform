import dotenv from 'dotenv';
import serverlessExpress from '@codegenie/serverless-express';
import { createApp } from './app.js';
import { initDB } from './db.js';
import projects from './projects.js';

// Used locally when invoking the handler. AWS supplies these values through
// Lambda environment variables in production.
dotenv.config();

const db = initDB();
for (const project of projects) {
  await project.checkDatabase?.(db);
}

export const handler = serverlessExpress({ app: createApp() });
