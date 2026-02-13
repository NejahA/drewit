import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import cors from 'cors';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
  }
});

const MONGODB_URI = process.env.MONGODB_URI;
const DRAWING_ID = 'global-canvas';

// MongoDB Drawing Schema
const DrawingSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  snapshot: { type: mongoose.Schema.Types.Mixed, required: true }
}, { timestamps: true, strict: false });

const Drawing = mongoose.models.Drawing || mongoose.model('Drawing', DrawingSchema);

// Store current snapshot in memory for fast broadcasting
let currentSnapshot = null;

async function startServer() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');

    // Load initial snapshot from DB
    const drawing = await Drawing.findOne({ id: DRAWING_ID });
    if (drawing) {
      currentSnapshot = drawing.snapshot;
    }

    // --- REST API for Persistence (Fix for local dev) ---

    app.get('/api/drawing', async (req, res) => {
      try {
        const id = req.query.id || DRAWING_ID;
        const drawing = await Drawing.findOne({ id });
        res.status(200).json(drawing ? drawing.snapshot : null);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    app.post('/api/drawing', async (req, res) => {
      try {
        const { id = DRAWING_ID, snapshot } = req.body;
        if (!snapshot) return res.status(400).json({ error: 'Snapshot missing' });
        
        await Drawing.findOneAndUpdate(
          { id },
          { snapshot },
          { upsert: true, new: true }
        );
        currentSnapshot = snapshot; // Update in-memory for Socket.io users
        res.status(200).json({ success: true });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // Mock/Bridge for Pusher triggers (if user is running locally)
    app.post('/api/pusher-trigger', async (req, res) => {
      try {
        const { id = DRAWING_ID, snapshot, changes, triggerReload, socketId } = req.body;
        
        // 1. Persistence
        if (snapshot) {
          await Drawing.findOneAndUpdate({ id }, { snapshot }, { upsert: true });
          currentSnapshot = snapshot;
        }

        // 2. Real-time Bridge (If Pusher is configured in .env, we could trigger it here)
        // For now, we respond success so the frontend doesn't error.
        // If the user has Vercel-like env vars, it will work with the Pusher library.
        
        console.log(`[API] Pusher-Trigger: ${snapshot ? 'Snapshot ' : ''}${changes ? 'Changes ' : ''}${triggerReload ? 'Reload' : ''}`);
        
        res.status(200).json({ success: true });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    io.on('connection', (socket) => {
      console.log('User connected:', socket.id);

      // Send initial state to the new client
      if (currentSnapshot) {
        socket.emit('init-store', currentSnapshot);
      }

      // Handle updates from clients
      socket.on('update-store', async (snapshot) => {
        currentSnapshot = snapshot;
        // Broadcast to other clients
        socket.broadcast.emit('sync-store', snapshot);
      });

      socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
      });
    });

    // Periodically save to MongoDB
    setInterval(async () => {
      if (currentSnapshot) {
        try {
          await Drawing.findOneAndUpdate(
            { id: DRAWING_ID },
            { snapshot: currentSnapshot },
            { upsert: true }
          );
          console.log('Snapshot periodically saved to MongoDB');
        } catch (err) {
          console.error('Error auto-saving snapshot:', err);
        }
      }
    }, 10000);

    const PORT = process.env.PORT || 5000;
    httpServer.listen(PORT, () => {
      console.log(`Socket.io server running on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
  }
}

startServer();
