// server.js
import express from 'express';
import dotenv from 'dotenv';
import OpenAI from 'openai';

import configuredCors from './middlewares/corsConfig.js';
// Note: multerConfig.js exports the configured 'upload' instance, which is used in ocrRoutes.js directly.
import createOcrRoutes from './routes/ocrRoutes.js';

// ---------- config ----------
dotenv.config();
const PORT = process.env.PORT || 3000;

// OpenAI client
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ---------- app setup ----------
const app = express();

// ---------- middleware ----------
app.use(configuredCors); // Use the configured CORS middleware
// express.json() and express.urlencoded() can be added here if needed for other routes or globally
// app.use(express.json());

// ---------- routes ----------
// Pass the openai client to the route creation function
const ocrRoutes = createOcrRoutes(openai);
app.use('/', ocrRoutes); // Mount OCR routes (e.g., /extract-text)

// Health check (can remain here or be moved to its own route file if it grows)
app.get('/', (_, res) => {
  // Check if the request is for the root path specifically, not just any path starting with /
  if (req.path === '/') { 
    res.send('web-ocr backend up and healthy');
  } else {
    // If it was handled by ocrRoutes, it won't reach here unless ocrRoutes calls next().
    // For a simple setup, this effectively means only / is the health check.
    // If ocrRoutes was mounted at /api, then GET / would be unambiguous.
    // For now, let's assume /extract-text is the only other POST route.
    res.status(404).send('Not Found'); // Or let ocrRoutes handle its own 404s if a path isn't matched there
  }
});


// ---------- server listen ----------
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`)); 