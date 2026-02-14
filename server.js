import express from 'express';
import { randomUUID } from 'crypto';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import cors from 'cors';
import Pusher from 'pusher';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' })); // Increase limit for snapshots

const MONGODB_URI = process.env.MONGODB_URI;
const PORT = process.env.PORT || 5000;

// Pusher Setup
const pusher = new Pusher({
  appId: process.env.PUSHER_APP_ID,
  key: process.env.VITE_PUSHER_KEY,
  secret: process.env.PUSHER_SECRET,
  cluster: process.env.VITE_PUSHER_CLUSTER,
  useTLS: true,
});

// MongoDB Schema
const DrawingSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  snapshot: { type: mongoose.Schema.Types.Mixed, required: true }
}, { timestamps: true, strict: false });

const Drawing = mongoose.models.Drawing || mongoose.model('Drawing', DrawingSchema);

const AssetSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  mimeType: { type: String, required: true },
  data: { type: Buffer, required: true },
}, { timestamps: true });
const Asset = mongoose.models.Asset || mongoose.model('Asset', AssetSchema);

// Connect to MongoDB
mongoose.connect(MONGODB_URI)
  .then(() => console.log('✅ Connected to MongoDB'))
  .catch(err => console.error('❌ MongoDB Connection Error:', err));

// Routes

// GET /api/drawing
app.get('/api/drawing', async (req, res) => {
  const { id } = req.query;
  const targetId = id || 'global-canvas';
  
  try {
    const drawing = await Drawing.findOne({ id: targetId });
    if (!drawing) {
      return res.status(200).json(null);
    }
    res.status(200).json(drawing.snapshot);
  } catch (err) {
    console.error('GET /api/drawing Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/drawing
app.post('/api/drawing', async (req, res) => {
  const { id, snapshot } = req.body;
  const targetId = id || 'global-canvas';

  if (!snapshot) {
    return res.status(400).json({ error: 'Snapshot is required' });
  }

  try {
    await Drawing.findOneAndUpdate(
      { id: targetId },
      { snapshot },
      { upsert: true, new: true }
    );
    console.log(`💾 Saved snapshot for ${targetId}`);
    res.status(200).json({ success: true });
  } catch (err) {
    console.error('POST /api/drawing Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/pusher-trigger
app.post('/api/pusher-trigger', async (req, res) => {
  const { id, snapshot, changes, socketId } = req.body;
  const targetId = id || 'global-canvas';

  try {
    // 1. Persistence Fallback (if snapshot provided)
    if (snapshot) {
      await Drawing.findOneAndUpdate(
        { id: targetId },
        { snapshot },
        { upsert: true }
      );
      console.log(`💾 [Pusher] Persisted snapshot for ${targetId}`);
    }

    // 2. Broadcast Diff
    if (changes) {
      const pusherOptions = socketId ? { socket_id: socketId } : {};
      try {
        await pusher.trigger(`drawing-${targetId}`, 'drawing-diff', { changes }, pusherOptions);
        console.log(`📡 [Pusher] Broadcasted diff for ${targetId}`);
      } catch (pusherErr) {
        if (pusherErr.status === 413 || pusherErr.message?.includes('too large')) {
          console.warn(`⚠️ [Pusher] Payload too large for ${targetId}. Triggering full sync request.`);
          // Fallback: Tell clients to fetch full snapshot from DB
          await pusher.trigger(`drawing-${targetId}`, 'drawing-sync-request', {}, pusherOptions);
        } else {
          throw pusherErr;
        }
      }
    }

    res.status(200).json({ success: true });
  } catch (err) {
    console.error('POST /api/pusher-trigger Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/asset – upload image for cross-tab sync
app.post('/api/asset', async (req, res) => {
  const { data: base64, mimeType } = req.body || {};
  if (!base64 || !mimeType) {
    return res.status(400).json({ error: 'Missing data or mimeType' });
  }
  try {
    const id = randomUUID();
    await Asset.create({ id, mimeType, data: Buffer.from(base64, 'base64') });
    res.status(200).json({ id, src: `/api/asset?id=${id}` });
  } catch (err) {
    console.error('POST /api/asset Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/asset?id=xxx or /api/asset/:id – serve asset so other tabs can load it
app.get('/api/asset', async (req, res) => {
  const id = req.query.id;
  if (!id) return res.status(400).json({ error: 'Missing id' });
  try {
    const asset = await Asset.findOne({ id });
    if (!asset) return res.status(404).json({ error: 'Asset not found' });
    res.setHeader('Content-Type', asset.mimeType);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(asset.data);
  } catch (err) {
    console.error('GET /api/asset Error:', err);
    res.status(500).json({ error: err.message });
  }
});
app.get('/api/asset/:id', async (req, res) => {
  try {
    const asset = await Asset.findOne({ id: req.params.id });
    if (!asset) return res.status(404).json({ error: 'Asset not found' });
    res.setHeader('Content-Type', asset.mimeType);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(asset.data);
  } catch (err) {
    console.error('GET /api/asset Error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
