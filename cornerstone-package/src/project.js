import routes from './routes.js';

export default {
  name: 'cornerstone-package',
  basePath: '/api/cornerstone-package',
  router: routes,
  async checkDatabase(db) {
    const { error: pkgError } = await db.from('packages').select('id').limit(1);
    if (pkgError) throw new Error(`cornerstone-package packages: ${pkgError.message}`);
    const { error: sduiError } = await db.from('cornerstone_sdui_templates').select('id').limit(1);
    if (sduiError) throw new Error(`cornerstone-package SDUI: ${sduiError.message}`);
  }
};
