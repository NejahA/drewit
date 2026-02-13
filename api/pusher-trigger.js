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

  const { id, snapshot, changes, socketId, triggerReload } = req.body;
  
  if (!PUSHER_APP_ID || !PUSHER_SECRET) {
    return res.status(500).json({ error: 'Pusher server-side configuration missing' });
  }

  try {
    // 1. If snapshot is provided, save to MongoDB (Persistence)
    if (snapshot) {
      const size = JSON.stringify(snapshot).length;
      console.log(`[Pusher] Attempting to persist ${size} bytes to DB for ${id}`);
      
      if (size > 4000000) { // 4MB Warning (Vercel limit is 4.5MB)
        console.warn(`[Pusher] WARNING: Large payload (${size} bytes). Risk of 413 Payload Too Large.`);
      }

      await connectToDatabase();
      const result = await Drawing.findOneAndUpdate(
        { id }, 
        { snapshot }, 
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      
      if (!result) throw new Error('Failed to update MongoDB document');
      console.log(`[Pusher] Persisted full snapshot for ${id} (${size} bytes)`);
    }

    // 2. If triggerReload is true, broadcast a global reload signal
    if (triggerReload) {
      const pusherOptions = socketId ? { socket_id: socketId } : {};
      await pusher.trigger(`drawing-${id}`, 'drawing-reload', {}, pusherOptions);
      console.log(`[Pusher] Broadcasted RELOAD signal for ${id}`);
    }

    // 3. If changes (diff) are provided, broadcast via Pusher (Real-time sync)
    if (changes) {
      const pusherOptions = socketId ? { socket_id: socketId } : {};
      await pusher.trigger(`drawing-${id}`, 'drawing-diff', { changes }, pusherOptions);
      console.log(`[Pusher] Broadcasted incremental diff for ${id}`);
    }

    res.status(200).json({ success: true });
  } catch (err) {
    console.error('[Pusher] ERROR:', err);
    res.status(500).json({ 
      error: 'Pusher/DB Operation Failed', 
      details: err.message,
      code: err.code
    });
  }
}
