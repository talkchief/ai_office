// The model providers routes: keys, activated models, a connection test and a provider's model list. A single office mounts
// them at /api/providers on its own registry; the platform admin panel mounts the same handlers at /api/admin/providers
// on the platform registry every hosted office inherits.
import { readJsonBody as body } from '../http-body.mjs';

export function registerProviderRoutes(router, models, prefix = '/api/providers', { record = () => {}, onChange = () => {} } = {}) {
  router.on('GET', prefix, () => models.summary());
  router.on('PUT', prefix, async ({ req }) => { const before = structuredClone(models.value); const result = models.update(await body(req, 1024 * 1024)); record({ area: 'providers', summary: 'Updated models and keys', before, after: models.value }); onChange(); return result; });
  router.on('POST', prefix + '/:id/test', ({ params }) => models.test(params.id));
  router.on('GET', prefix + '/:id/models', ({ params }) => models.listModels(params.id));
}
