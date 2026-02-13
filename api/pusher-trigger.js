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

  const { id, snapshot, changes, socketId } = req.body;
  
  if (!PUSHER_APP_ID || !PUSHER_SECRET) {
    return res.status(500).json({ error: 'Pusher server-side configuration missing' });
  }

  try {
    // 1. If snapshot is provided, save to MongoDB (Persistence fallback)
    if (snapshot) {
      await connectToDatabase();
      await Drawing.findOneAndUpdate({ id }, { snapshot }, { upsert: true });
      console.log(`[Pusher] Persisted full snapshot for ${id}`);
    }

    // 2. If changes (diff) are provided, broadcast via Pusher (Real-time sync)
    if (changes) {
      const pusherOptions = socketId ? { socket_id: socketId } : {};
      
      try {
        // Broadcast the diff to other clients
        await pusher.trigger(`drawing-${id}`, 'drawing-diff', {
          changes,
        }, pusherOptions);
        console.log(`[Pusher] Broadcasted incremental diff for ${id} (Excluded: ${socketId || 'none'})`);
      } catch (pusherErr) {
        if (pusherErr.status === 413 || pusherErr.message?.includes('too large')) {
          console.warn(`[Pusher] Payload too large for ${id}. Triggering full sync request.`);
          // Fallback: Tell clients to fetch full snapshot from DB
          await pusher.trigger(`drawing-${id}`, 'drawing-sync-request', {}, pusherOptions);
        } else {
          throw pusherErr;
        }
      }
    }

    res.status(200).json({ success: true });
  } catch (err) {
    console.error('[Pusher] Server Error:', err);
    res.status(500).json({ 
      error: 'Pusher Operation Failed', 
      details: err.message 
    });
  }
}
