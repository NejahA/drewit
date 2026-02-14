import { connectToDatabase, Asset } from './_lib/db.js';
import { randomUUID } from 'crypto';

// Single route: POST = upload, GET ?id=xxx = serve (avoids Vercel dynamic path issues)
export default async function handler(req, res) {
  if (req.method === 'GET') {
    let id = req.query.id;
    if (!id && req.url) {
      const match = req.url.match(/\/api\/asset\/([^/?#]+)/);
      if (match) id = match[1];
    }
    if (!id) {
      return res.status(400).json({ error: 'Missing id' });
    }
    try {
      await connectToDatabase();
      const asset = await Asset.findOne({ id });
      if (!asset) {
        return res.status(404).json({ error: 'Asset not found' });
      }
      res.setHeader('Content-Type', asset.mimeType);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      return res.status(200).send(asset.data);
    } catch (err) {
      console.error('[API] Asset get error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body || {};
    const { data: base64, mimeType } = body;

    if (!base64 || !mimeType) {
      return res.status(400).json({ error: 'Missing data or mimeType' });
    }

    const buffer = Buffer.from(base64, 'base64');
    const id = randomUUID();

    await connectToDatabase();
    await Asset.create({ id, mimeType, data: buffer });

    res.status(200).json({ id, src: `/api/asset?id=${id}` });
  } catch (err) {
    console.error('[API] Asset upload error:', err);
    res.status(500).json({ error: err.message });
  }
}
