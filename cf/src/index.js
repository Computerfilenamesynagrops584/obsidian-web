export { VaultDO } from './vault-do.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (env.DEMO_MODE !== 'true') {
      const key = request.headers.get('X-Api-Key');
      if (key !== env.API_KEY) {
        return new Response('Unauthorized', { status: 401 });
      }
    }

    if (url.pathname.startsWith('/api/')) {
      const id = env.VAULT.idFromName('demo');
      return env.VAULT.get(id).fetch(request);
    }

    return env.ASSETS.fetch(request);
  },
};
