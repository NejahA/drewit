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
