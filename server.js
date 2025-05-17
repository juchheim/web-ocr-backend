// server.js
import express from 'express';
import multer from 'multer';
import cors from 'cors';
import dotenv from 'dotenv';
import OpenAI from 'openai';

// ---------- config ----------
dotenv.config();
const PORT = process.env.PORT || 3000;
const envFrontendOrigin = process.env.FRONTEND_ORIGIN; // For checking env var

// OpenAI client
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ---------- middleware ----------
const app = express();

const allowedOrigins = [
  'https://web-ocr-frontend-kappa.vercel.app',
  'https://web-ocr-frontend-git-main-ernest-juchheims-projects.vercel.app',
  'https://web-ocr-frontend-i17xzv2ko-ernest-juchheims-projects.vercel.app'
];

// If FRONTEND_ORIGIN is set in .env or environment, add it to the list of allowed origins.
if (envFrontendOrigin) {
  if (!allowedOrigins.includes(envFrontendOrigin)) { // Avoid duplicates
    allowedOrigins.push(envFrontendOrigin);
  }
}

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (e.g., curl requests, server-to-server, mobile apps if they don't send origin)
    if (!origin) {
      return callback(null, true);
    }

    // Allow localhost from any port for development
    if (/^http:\/\/localhost:/.test(origin) || /^http:\/\/127\.0\.0\.1:/.test(origin)) {
      return callback(null, true);
    }

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    
    console.error(`CORS blocked for origin: ${origin}. Allowed origins: ${allowedOrigins.join(', ')}`);
    callback(new Error(`CORS blocked for origin: ${origin}`));
  }
}));

const upload = multer({ storage: multer.memoryStorage() });

// ---------- routes ----------

app.post('/extract-text', upload.array('photos'), async (req, res) => {
  try {
    if (!req.files?.length) {
      return res.status(400).json({ error: 'No photos uploaded.' });
    }

    // Convert each buffer to a data URL accepted by OpenAI
    const mappedImages = req.files.map((file) => {
      const base64 = file.buffer.toString('base64');
      const dataUrl = `data:${file.mimetype};base64,${base64}`;
      return { type: 'image_url', image_url: { url: dataUrl, detail: 'low' } };
    });

    const openAiPayload = {
      model: 'gpt-4o',
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Extract all visible text exactly as it appears. Return plain text only.' },
            ...mappedImages,
          ],
        },
      ],
    };

    // Log the exact payload being sent to OpenAI for debugging
    console.log('Sending to OpenAI:', JSON.stringify(openAiPayload, null, 2));

    const completion = await openai.chat.completions.create(openAiPayload);

    const text = completion.choices?.[0]?.message?.content?.trim() || '';
    res.json({ text });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to process images.' });
  }
});

// Health check
app.get('/', (_, res) => res.send('web-ocr backend up'));

app.listen(PORT, () => console.log(`Server listening on port ${PORT}`)); 