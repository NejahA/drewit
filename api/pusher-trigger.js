import Pusher from 'pusher';
import { connectToDatabase, Drawing } from './_lib/db.js';

const PUSHER_APP_ID = process.env.PUSHER_APP_ID;
const VITE_PUSHER_KEY = process.env.VITE_PUSHER_KEY;
const PUSHER_SECRET = process.env.PUSHER_SECRET;
const VITE_PUSHER_CLUSTER = process.env.VITE_PUSHER_CLUSTER;

if (!PUSHER_APP_ID || !VITE_PUSHER_KEY || !PUSHER_SECRET || !VITE_PUSHER_CLUSTER) {
  console.error('[Pusher] Missing Environment Variables');
}

const pusher = new Pusher({
  appId: PUSHER_APP_ID,
  key: VITE_PUSHER_KEY,
  secret: PUSHER_SECRET,
  cluster: VITE_PUSHER_CLUSTER,
  useTLS: true,
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id, snapshot, socketId, timestamp } = req.body;
  
  if (!PUSHER_APP_ID || !PUSHER_SECRET) {
    return res.status(500).json({ error: 'Pusher server-side configuration missing' });
  }

  try {
    // 1. Save to MongoDB (Persistence)
    await connectToDatabase();
    const result = await Drawing.findOneAndUpdate(
      { id },
      { snapshot },
      { upsert: true, new: true }
    );
    
    if (result) {
      console.log(`[Pusher] DB Update Successful for ${id}`);
    }

    // 2. Trigger Pusher Event (Exclude sender if socketId is provided)
    const pusherOptions = socketId ? { socket_id: socketId } : {};
    await pusher.trigger(`drawing-${id}`, 'drawing-update', {
      snapshot,
      timestamp: timestamp || Date.now(),
    }, pusherOptions);

    console.log(`[Pusher] Event triggered for ${id} (Excluded: ${socketId || 'none'})`);
    res.status(200).json({ success: true });
  } catch (err) {
    console.error('[Pusher] Error in pusher-trigger:', err);
    res.status(500).json({ error: err.message });
  }
}
