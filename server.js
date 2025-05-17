// server.js
import express from 'express';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import mongoose from 'mongoose'; // Changed from MongoClient
import path from 'path'; // Import path module
import { fileURLToPath } from 'url'; // Import fileURLToPath module

import configuredCors from './middlewares/corsConfig.js';
// Note: multerConfig.js exports the configured 'upload' instance, which is used in ocrRoutes.js directly.
import createOcrRoutes from './routes/ocrRoutes.js';
import authRoutes, { protect as protectRoute } from './routes/auth.js'; // Import auth routes and protect middleware

// Determine __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------- config ----------
// Explicitly load .env file from the backend directory
dotenv.config({ path: path.resolve(__dirname, '.env') }); 
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;

if (!process.env.JWT_SECRET) {
    console.warn('WARNING: JWT_SECRET is not set in .env file. Using default, which is insecure.');
}
if (!MONGODB_URI) {
    console.error('FATAL ERROR: MONGODB_URI is not defined in the .env file.');
    process.exit(1);
}
if (!process.env.OPENAI_API_KEY) {
    console.error('FATAL ERROR: OPENAI_API_KEY is not defined in the .env file.');
    process.exit(1);
}

// OpenAI client
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// MongoDB database instance (db will be set by Mongoose connection)
let db;

// ---------- app setup ----------
const app = express();

// ---------- middleware ----------
app.use(configuredCors); // Use the configured CORS middleware
app.use(express.json()); // Middleware to parse JSON bodies (needed for auth routes)
app.use(express.urlencoded({ extended: true })); // Middleware for URL-encoded data

// ---------- helper functions ----------
async function connectDB() {
  try {
    await mongoose.connect(MONGODB_URI, {
        // Mongoose 6+ options are generally handled by default, but you can add specific ones if needed
        // useNewUrlParser: true, // Not needed in Mongoose 6+
        // useUnifiedTopology: true, // Not needed in Mongoose 6+
        // useCreateIndex: true, // Not supported, use createIndexes option on model schema if needed
    });
    db = mongoose.connection; // Assign the connection to db
    console.log("Successfully connected to MongoDB using Mongoose!");
  } catch (err) {
    console.error("Failed to connect to MongoDB", err);
    process.exit(1);
  }
}

async function startServer() {
  await connectDB(); // Ensure DB is connected before starting the rest

  // ---------- routes ----------
  app.use('/auth', authRoutes); // Mount authentication routes (e.g., /auth/login, /auth/register)

  // Pass openai client and Mongoose connection (db) to ocrRoutes factory
  // Protect the /extract-text route
  const ocrRoutes = createOcrRoutes(openai, db); 
  // Assuming ocrRoutes is an Express router instance
  // And that /extract-text is a POST route on it
  // To protect a specific route within ocrRoutes, it's better to apply middleware in ocrRoutes.js
  // For now, if ocrRoutes only contains /extract-text, we can do this:
  // app.use('/', protectRoute, ocrRoutes); // This would protect all routes in ocrRoutes
  // Let's assume createOcrRoutes returns a router and we want to protect its main endpoint
  // The most straightforward way is to modify ocrRoutes.js to accept and use the `protectRoute` middleware.
  // However, for a quick application, if /extract-text is the primary route:
  // We need to ensure `ocrRoutes` are defined *after* `authRoutes` if they share base paths or have catch-alls.
  // And that the middleware is applied correctly.

  // For the /extract-text route specifically:
  // We need to get the router from createOcrRoutes and then find the specific route to protect.
  // Or, more simply, modify ocrRoutes.js. 
  // Let's assume ocrRoutes.js exports a router that has a POST /extract-text route.
  // A common pattern: router.post('/extract-text', upload.array('photos'), (req, res) => { ... });
  // We would change it to: router.post('/extract-text', protectRoute, upload.array('photos'), (req, res) => { ... });
  
  // For now, let's just mount it. We'll need to modify ocrRoutes.js to use `protectRoute`
  app.use('/', ocrRoutes); // Mount OCR routes (e.g., /extract-text)

  // Health check
  app.get('/', (req, res) => {
    // This route might conflict if ocrRoutes also defines a GET '/'.
    // It's better to have a specific health check endpoint like /health
    if (mongoose.connection.readyState === 1) { // 1 for connected
        res.send('web-ocr backend up and healthy, MongoDB connected via Mongoose.');
    } else {
        res.status(503).send('web-ocr backend is unhealthy, MongoDB connection issue.');
    }
  });

  // ---------- server listen ----------
  app.listen(PORT, () => console.log(`Server listening on port ${PORT}. MongoDB ready.`));
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('SIGINT received. Shutting down gracefully...');
  if (mongoose.connection.readyState === 1) {
    await mongoose.disconnect();
    console.log('MongoDB connection closed.');
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  if (mongoose.connection.readyState === 1) {
    await mongoose.disconnect();
    console.log('MongoDB connection closed.');
  }
  process.exit(0);
});

// Start the server
startServer().catch(err => {
  console.error("Failed to start server:", err);
  process.exit(1);
}); 