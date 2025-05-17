import express from 'express';
import upload from '../middlewares/multerConfig.js';

// This function accepts the openai client and db instance as arguments
export default function createOcrRoutes(openai, db) {
  const router = express.Router();

  router.post('/extract-text', upload.array('photos'), async (req, res) => {
    try {
      if (!req.files?.length) {
        return res.status(400).json({ error: 'No photos uploaded.' });
      }

      const mappedImages = req.files.map((file) => {
        const base64 = file.buffer.toString('base64');
        const dataUrl = `data:${file.mimetype};base64,${base64}`;
        return { type: 'image_url', image_url: { url: dataUrl, detail: 'low' } };
      });

      const openAiPayload = {
        model: 'gpt-4.1-nano',
        max_tokens: 2048,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Scan the image(s) for an asset tag number. An asset tag number is a numerical identifier, typically 5 digits long (e.g., 12345). Identify the most likely asset tag number from any text visible. Return only this 5-digit number. If multiple plausible 5-digit asset tags are found, return the most prominent or clearest one. If no 5-digit asset tag is clearly identifiable, return an empty string.' },
              ...mappedImages,
            ],
          },
        ],
      };

      // logging
      // Log the model being used and the exact payload being sent to OpenAI for debugging
      console.log(`Using OpenAI model: ${openAiPayload.model}`);
      console.log('Sending to OpenAI:', JSON.stringify(openAiPayload, null, 2));

      const completion = await openai.chat.completions.create(openAiPayload);
      const assetTag = completion.choices?.[0]?.message?.content?.trim() || '';
      
      // Save to MongoDB if assetTag is found
      if (assetTag && assetTag.trim() !== '') {
        try {
          const assetTagsCollection = db.collection('asset_tags');
          const docToInsert = { 
            assetTag: assetTag.trim(), 
            scannedAt: new Date() 
          };
          const result = await assetTagsCollection.insertOne(docToInsert);
          console.log(`Asset tag '${assetTag}' saved to MongoDB with id: ${result.insertedId}`);
        } catch (dbErr) {
          console.error("Error saving asset tag to MongoDB:", dbErr); 
          // Optionally, inform the client of DB error, but for now, prioritize OCR result
        }
      }
      
      res.json({ text: assetTag });

    } catch (err) {
      console.error('Error in /extract-text route:', err);
      // Ensure that the error response includes a JSON body, as expected by the frontend
      let errorMessage = 'Failed to process images.';
      if (err.response && err.response.data && err.response.data.error && err.response.data.error.message) {
        errorMessage = err.response.data.error.message; // Use OpenAI specific error if available
      } else if (err.message) {
        errorMessage = err.message;
      }
      res.status(500).json({ error: 'Failed to process images.', details: errorMessage });
    }
  });

  return router;
} 