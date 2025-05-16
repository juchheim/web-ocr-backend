// server.js
import express from 'express';
import multer from 'multer';
import cors from 'cors';
import dotenv from 'dotenv';
import OpenAI from 'openai';

// ---------- config ----------
dotenv.config();
const PORT = process.env.PORT || 3000;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'https://YOUR_FRONTEND.vercel.app';

// OpenAI client
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ---------- middleware ----------
const app = express();
app.use(cors({ origin: FRONTEND_ORIGIN }));

const upload = multer({ storage: multer.memoryStorage() });

// ---------- routes ----------

app.post('/extract-text', upload.array('photos'), async (req, res) => {
  try {
    if (!req.files?.length) {
      return res.status(400).json({ error: 'No photos uploaded.' });
    }

    // Convert each buffer to a data URL accepted by OpenAI
    const images = req.files.map((file) => {
      const base64 = file.buffer.toString('base64');
      const dataUrl = `data:${file.mimetype};base64,${base64}`;
      return { type: 'image_url', image_url: { url: dataUrl } };
    });

    const completion = await openai.chat.completions.create({
      model: 'gpt-4.1-nano',
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Extract all visible text exactly as it appears. Return plain text only.' },
            ...images,
          ],
        },
      ],
      detail: 'low',
    });

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