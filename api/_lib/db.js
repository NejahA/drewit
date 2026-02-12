const mongoose = require('mongoose');

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
  if (cachedDb) {
    return cachedDb;
  }

  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI environment variable is not defined');
  }
  // Connect to MongoDB
  const db = await mongoose.connect(process.env.MONGODB_URI);
  
  cachedDb = db;
  return db;
}

module.exports = {
  connectToDatabase,
  Drawing
};
