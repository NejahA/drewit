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
    type: mongoose.Schema.Types.Mixed,
    required: true
  }
}, {
  timestamps: true,
  strict: false
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

  // Diagnostic logging (Redacted)
  const uri = process.env.MONGODB_URI;
  const length = uri.length;
  const prefix = uri.substring(0, 15);
  const isValidScheme = uri.startsWith('mongodb://') || uri.startsWith('mongodb+srv://');

  console.log(`Connecting to MongoDB... (Length: ${length}, Prefix: "${prefix}...", Valid Scheme: ${isValidScheme})`);

  if (!isValidScheme) {
    console.error(`SERVERLESS ERROR: Invalid MongoDB URI scheme. Expected "mongodb://" or "mongodb+srv://". Got: "${prefix}..."`);
    throw new Error(`Invalid MongoDB connection string scheme. Check your MONGODB_URI environment variable.`);
  }

  try {
    const db = await mongoose.connect(uri, {
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
