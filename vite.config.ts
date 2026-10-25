import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
// @ts-expect-error plain JS module shared with the Vercel function
import { handle } from './api/_lib/hubspot.js';

/** Serves /api/hubspot/* during `vite dev` with the same code the Vercel function runs in production. */
function hubspotDevApi(): Plugin {
  return {
    name: 'storesense-hubspot-dev-api',
    configureServer(server) {
      server.middlewares.use('/api/hubspot', async (req, res) => {
        const action = (req.url ?? '').replace(/^\//, '').split('?')[0];
        let raw = '';
        for await (const chunk of req) raw += chunk;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        try {
          const result = await handle(action, req.method, raw ? JSON.parse(raw) : {});
          res.end(JSON.stringify(result));
        } catch (e) {
          const err = e as Error & { status?: number };
          res.statusCode = err.status ?? 500;
          res.end(JSON.stringify({ error: err.message }));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), hubspotDevApi()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
