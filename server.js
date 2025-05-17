// server.js
import express from 'express';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import { MongoClient, ServerApiVersion } from 'mongodb';

import configuredCors from './middlewares/corsConfig.js';
// Note: multerConfig.js exports the configured 'upload' instance, which is used in ocrRoutes.js directly.
import createOcrRoutes from './routes/ocrRoutes.js';

// ---------- config ----------
dotenv.config();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;

// OpenAI client
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// MongoDB client and database instance
let db;
let mongoClient;

// ---------- app setup ----------
const app = express();

// ---------- helper functions ----------
async function connectDB() {
  if (!MONGODB_URI) {
    console.error('FATAL ERROR: MONGODB_URI is not defined in the .env file.');
    process.exit(1);
  }
  mongoClient = new MongoClient(MONGODB_URI, {
    serverApi: {
      version: ServerApiVersion.v1,
      strict: true,
      deprecationErrors: true,
    }
  });
  try {
    await mongoClient.connect();
    db = mongoClient.db("web_ocr_db"); // Using "web_ocr_db" as the database name
    console.log("Successfully connected to MongoDB!");
  } catch (err) {
    console.error("Failed to connect to MongoDB", err);
    process.exit(1);
  }
}

async function startServer() {
  await connectDB(); // Ensure DB is connected before starting the rest

  // ---------- middleware ----------
  app.use(configuredCors); // Use the configured CORS middleware
  // express.json() and express.urlencoded() can be added here if needed for other routes or globally
  // app.use(express.json());

  // ---------- routes ----------
  const ocrRoutes = createOcrRoutes(openai, db); // Pass openai client and db instance
  app.use('/', ocrRoutes); // Mount OCR routes (e.g., /extract-text)

  // Health check
  app.get('/', (req, res) => {
    if (req.path === '/') {
      res.send('web-ocr backend up and healthy, MongoDB connected.');
    } else {
      // This else might not be reached if ocrRoutes handles all other GET requests at root or calls next()
      // Or if it doesn't handle GET requests other than specific ones.
      res.status(404).send('Not Found'); 
    }
  });

  // ---------- server listen ----------
  app.listen(PORT, () => console.log(`Server listening on port ${PORT}. MongoDB ready.`));
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('SIGINT received. Shutting down gracefully...');
  if (mongoClient) {
    await mongoClient.close();
    console.log('MongoDB connection closed.');
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  if (mongoClient) {
    await mongoClient.close();
    console.log('MongoDB connection closed.');
  }
  process.exit(0);
});

// Start the server
startServer().catch(err => {
  console.error("Failed to start server:", err);
  process.exit(1);
}); 