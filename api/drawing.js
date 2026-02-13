import mongoose from 'mongoose';
import { connectToDatabase, Drawing } from './_lib/db.js';

export default async function handler(req, res) {
  try {
    await connectToDatabase();

    const { method } = req;
    const { id: queryId } = req.query;
    const { id: bodyId, snapshot } = req.body || {};

    const id = queryId || bodyId || 'global-canvas';

    switch (method) {
      case 'GET':
        try {
          const drawing = await Drawing.findOne({ id });
          if (!drawing) {
            return res.status(200).json(null);
          }
          res.status(200).json(drawing.snapshot);
        } catch (err) {
          res.status(500).json({ error: `GET Error: ${err.message}` });
        }
        break;

      case 'POST':
        try {
          const body = req.body;
          const targetId = id;
          const targetSnapshot = snapshot || body?.snapshot;

          console.log(`[POST] Request for ID: ${targetId}, Snapshot Present: ${!!targetSnapshot}`);
          
          if (targetSnapshot) {
            const size = JSON.stringify(targetSnapshot).length;
            console.log(`[POST] Snapshot size: ${size} bytes`);
          }

          if (!targetSnapshot) {
            console.warn('[POST] Missing snapshot in request body');
            return res.status(400).json({ error: 'Snapshot is required' });
          }

          // Force check connection
          if (mongoose.connection.readyState !== 1) {
            console.log('MongoDB connection not ready, reconnecting...');
            await connectToDatabase();
          }

          const updatedDrawing = await Drawing.findOneAndUpdate(
            { id: targetId },
            { snapshot: targetSnapshot },
            { upsert: true, new: true, setDefaultsOnInsert: true }
          );

          console.log(`[POST] Database update successful for ${targetId}`);
          res.status(200).json({ success: true, id: updatedDrawing.id });
        } catch (err) {
          console.error(`[POST] Persistence Error for ${id}:`, err);
          res.status(500).json({ error: `Persistence Error: ${err.message}` });
        }
        break;

      default:
        res.setHeader('Allow', ['GET', 'POST']);
        res.status(405).end(`Method ${method} Not Allowed`);
    }
  } catch (err) {
    console.error('Unhandled Serverless Error:', err);
    res.status(500).json({ 
      error: 'Unhandled Internal Server Error', 
      details: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
}
