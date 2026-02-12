import mongoose from 'mongoose';

// Mongoose Model
const DrawingSchema = new mongoose.Schema({
  id: {
    type: String,
    required: true,
    unique: true,
    default: 'global-canvas'
  },
  snapshot: {
    type: Object,
    required: true
  }
}, {
  timestamps: true
});

const Drawing = mongoose.models.Drawing || mongoose.model('Drawing', DrawingSchema);
 
// Cached connection for Serverless Functions
let cachedDb = null;
 
async function connectToDatabase() {
  if (cachedDb && mongoose.connection.readyState === 1) {
    return cachedDb;
  }

  if (!process.env.MONGODB_URI) {
    console.error('SERVERLESS ERROR: MONGODB_URI is not defined');
    throw new Error('MONGODB_URI environment variable is not defined');
  }

  try {
    console.log('Connecting to MongoDB...');
    const db = await mongoose.connect(process.env.MONGODB_URI, {
      bufferCommands: false,
    });
    console.log('MongoDB connected successfully');
    cachedDb = db;
    return db;
  } catch (err) {
    console.error('SERVERLESS ERROR: MongoDB connection failed', err);
    throw err;
  }
}

export {
  connectToDatabase,
  Drawing
};
