import { connectToDatabase, Asset } from './_lib/db.js';
import { randomUUID } from 'crypto';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
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

    res.status(200).json({ id, src: `/api/asset/${id}` });
  } catch (err) {
    console.error('[API] Asset upload error:', err);
    res.status(500).json({ error: err.message });
  }
}
