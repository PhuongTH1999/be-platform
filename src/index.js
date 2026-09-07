import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { initDB, closeDB } from './db.js';
import routes from './routes.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Request logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});

// Routes
app.use('/api', routes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'Package Sync API',
    version: '1.0.0',
    description: 'Free public API to sync package versions and changelogs',
    endpoints: {
      health: 'GET /api/health',
      listPackages: 'GET /api/packages',
      getPackage: 'GET /api/packages/:name',
      getVersions: 'GET /api/packages/:name/versions',
      syncPackage: 'POST /api/packages/sync'
    }
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Endpoint not found'
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({
    error: 'Internal server error'
  });
});

// Graceful shutdown
function shutdown() {
  console.log('\n🛑 Shutting down gracefully...');
  closeDB();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Start server
try {
  initDB();
  app.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
    console.log(`📚 API docs at http://localhost:${PORT}/`);
  });
} catch (error) {
  console.error('Failed to start server:', error);
  process.exit(1);
}
