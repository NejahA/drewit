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
      const size = snapshot ? JSON.stringify(snapshot).length : 0;
      console.log(`[Pusher] DB Update Successful for ${id} (Size: ${size} bytes)`);
    }

    // 2. Trigger Pusher Event (Exclude sender if socketId is provided)
    const pusherOptions = socketId ? { socket_id: socketId } : {};
    const payload = {
      snapshot,
      timestamp: timestamp || Date.now(),
    };

    // Pusher has a 10KB limit for triggers
    const payloadSize = JSON.stringify(payload).length;
    if (payloadSize > 10000) {
      console.warn(`[Pusher] Payload too large: ${payloadSize} bytes. Max is 10,000 bytes.`);
      return res.status(413).json({ 
        error: 'Payload too large for Pusher sync', 
        size: payloadSize,
        message: 'Your drawing has too many shapes for instant sync. Try a smaller drawing or a paid Pusher plan.'
      });
    }

    await pusher.trigger(`drawing-${id}`, 'drawing-update', payload, pusherOptions);

    console.log(`[Pusher] Event triggered for ${id} (Size: ${payloadSize} bytes)`);
    res.status(200).json({ success: true });
  } catch (err) {
    console.error('[Pusher] Server Error:', err);
    res.status(500).json({ 
      error: 'Pusher Trigger Failed', 
      details: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
}
