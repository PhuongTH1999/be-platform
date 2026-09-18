import routes from './routes.js';

export default {
  name: 'cornerstone-package',
  basePath: '/api/cornerstone-package',
  router: routes,
  async checkDatabase(db) {
    const { error } = await db.from('packages').select('id').limit(1);
    if (error) throw new Error(`cornerstone-package: ${error.message}`);
  }
};
