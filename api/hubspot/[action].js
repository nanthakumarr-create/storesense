// Vercel serverless function: /api/hubspot/status (GET), /api/hubspot/import (POST), /api/hubspot/push (POST).
import { handle } from '../_lib/hubspot.js';

export default async function handler(req, res) {
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body;
    const result = await handle(req.query.action, req.method, body);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'HubSpot request failed' });
  }
}
