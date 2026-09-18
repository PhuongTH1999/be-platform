import { Router } from 'express';
import { templateStore } from './sdui-store.js';

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Validate the envelope, leaving widget types/properties open for renderer evolution.
function validate(body) {
  if (!isObject(body)) return 'Body must be an object containing name and schema';
  if (Object.keys(body).some(key => !['name', 'schema'].includes(key))) return 'Only name and schema are accepted';
  if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 200) return 'name must contain 1–200 characters';
  if (!isObject(body.schema) || body.schema.type !== 'template_widget' || body.schema.templateType !== 'SDUI_WIDGET' || !Array.isArray(body.schema.data)) {
    return 'schema must contain type=template_widget, templateType=SDUI_WIDGET and a data array';
  }
  // Bounded traversal prevents deeply nested JSON from exhausting the renderer/API.
  const stack = [{ value: body.schema, depth: 0 }];
  while (stack.length) {
    const { value, depth } = stack.pop();
    if (depth > 64) return 'schema exceeds maximum nesting depth of 64';
    if (value !== null && typeof value === 'object') {
      for (const child of Object.values(value)) stack.push({ value: child, depth: depth + 1 });
    }
  }
  return null;
}

export function createSduiRouter(store = templateStore) {
  const router = Router();
  // Avoid stale templates after an update or delete.
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.param('id', (req, res, next, id) => {
    if (!uuid.test(id)) return res.status(400).json({ error: 'Invalid template UUID' });
    next();
  });
  const handle = fn => async (req, res) => {
    try { await fn(req, res); }
    catch (error) {
      console.error('SDUI request failed:', error.code || 'database_error');
      if (['42P01', 'PGRST205'].includes(error.code)) {
        return res.status(503).json({ error: 'SDUI storage is not initialized' });
      }
      res.status(500).json({ error: 'Unable to process SDUI template request' });
    }
  };
  router.get('/templates', handle(async (req, res) => {
    const { limit = '50', offset = '0' } = req.query;
    if (typeof limit !== 'string' || typeof offset !== 'string' || !/^\d+$/.test(limit) || !/^\d+$/.test(offset) || Number(limit) < 1 || Number(limit) > 100 || !Number.isSafeInteger(Number(offset)) || Number(offset) > 1000000) {
      return res.status(400).json({ error: 'limit must be 1–100 and offset 0–1000000' });
    }
    const { data, count } = await store.list(Number(limit), Number(offset));
    res.json({ success: true, total: count, limit: Number(limit), offset: Number(offset), templates: data });
  }));
  router.post('/templates', handle(async (req, res) => {
    const error = validate(req.body);
    if (error) return res.status(400).json({ error });
    const template = await store.create({ name: req.body.name.trim(), schema: req.body.schema });
    res.location(`${req.baseUrl}/templates/${template.id}`).status(201).json({ success: true, template });
  }));
  router.get('/templates/:id/json', handle(async (req, res) => {
    const template = await store.get(req.params.id);
    if (!template) return res.status(404).json({ error: 'Template not found' });
    res.json(template.schema);
  }));
  router.get('/templates/:id', handle(async (req, res) => {
    const template = await store.get(req.params.id);
    if (!template) return res.status(404).json({ error: 'Template not found' });
    res.json({ success: true, template });
  }));
  router.put('/templates/:id', handle(async (req, res) => {
    const error = validate(req.body);
    if (error) return res.status(400).json({ error });
    const template = await store.update(req.params.id, { name: req.body.name.trim(), schema: req.body.schema });
    if (!template) return res.status(404).json({ error: 'Template not found' });
    res.json({ success: true, template });
  }));
  router.delete('/templates/:id', handle(async (req, res) => {
    const deleted = await store.remove(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Template not found' });
    res.status(204).end();
  }));
  return router;
}

export default createSduiRouter();
