import { connectToDatabase, Asset } from '../_lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id } = req.query;
  if (!id) {
    return res.status(400).json({ error: 'Missing asset id' });
  }

  try {
    await connectToDatabase();
    const asset = await Asset.findOne({ id });
    if (!asset) {
      return res.status(404).json({ error: 'Asset not found' });
    }

    res.setHeader('Content-Type', asset.mimeType);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.status(200).send(asset.data);
  } catch (err) {
    console.error('[API] Asset get error:', err);
    res.status(500).json({ error: err.message });
  }
}
