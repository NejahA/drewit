import Pusher from 'pusher';
import { connectToDatabase, Drawing } from './_lib/db.js';

const pusher = new Pusher({
  appId: process.env.PUSHER_APP_ID,
  key: process.env.VITE_PUSHER_KEY,
  secret: process.env.PUSHER_SECRET,
  cluster: process.env.VITE_PUSHER_CLUSTER,
  useTLS: true,
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id, snapshot } = req.body;

  try {
    // 1. Save to MongoDB (Persistence)
    await connectToDatabase();
    await Drawing.findOneAndUpdate(
      { id },
      { snapshot },
      { upsert: true }
    );

    // 2. Trigger Pusher Event (Real-time Broadcast)
    await pusher.trigger(`drawing-${id}`, 'drawing-update', {
      snapshot,
    });

    res.status(200).json({ success: true });
  } catch (err) {
    console.error('Pusher Trigger Error:', err);
    res.status(500).json({ error: err.message });
  }
}
