import express from 'express';
import upload from '../middlewares/multerConfig.js';

// This function accepts the openai client and db instance as arguments
export default function createOcrRoutes(openai, db) {
  const router = express.Router();

  router.post('/extract-text', upload.array('photos'), async (req, res) => {
    if (!req.files?.length) {
      return res.status(400).json({ error: 'No photos uploaded.' });
    }

    const allExtractedTexts = [];
    let hadError = false;

    for (const file of req.files) {
      try {
        const base64 = file.buffer.toString('base64');
        const dataUrl = `data:${file.mimetype};base64,${base64}`;
        const imagePayload = [{ type: 'image_url', image_url: { url: dataUrl, detail: 'low' } }];

        const openAiPayload = {
          model: 'gpt-4.1-nano',
          max_tokens: 2048, // Max tokens per image analysis
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: 'Scan the image(s) for an asset tag number. An asset tag number is a numerical identifier, typically 5 digits long (e.g., 12345). Identify the most likely asset tag number from any text visible. Return only this 5-digit number. If multiple plausible 5-digit asset tags are found, return the most prominent or clearest one. If no 5-digit asset tag is clearly identifiable, return an empty string.' },
                ...imagePayload, // Send only one image at a time
              ],
            },
          ],
        };

        console.log(`Processing one image. Using OpenAI model: ${openAiPayload.model}`);
        // console.log('Sending one image to OpenAI:', JSON.stringify(openAiPayload, null, 2)); // Can be verbose for multiple images

        const completion = await openai.chat.completions.create(openAiPayload);
        const assetTag = completion.choices?.[0]?.message?.content?.trim() || '';
        allExtractedTexts.push(assetTag); // Add to our array of results

        if (assetTag && assetTag.trim() !== '') {
          try {
            const assetTagsCollection = db.collection('asset_tags');
            const docToInsert = { 
              assetTag: assetTag.trim(), 
              scannedAt: new Date(),
              sourceImageOriginalName: file.originalname // Optional: store original filename
            };
            const result = await assetTagsCollection.insertOne(docToInsert);
            console.log(`Asset tag '${assetTag}' from image '${file.originalname || 'unknown'}' saved to MongoDB with id: ${result.insertedId}`);
          } catch (dbErr) {
            console.error("Error saving asset tag to MongoDB:", dbErr);
            // Continue processing other images even if one DB save fails
          }
        }
      } catch (err) {
        console.error(`Error processing image ${file.originalname || 'unknown'}:`, err);
        allExtractedTexts.push(''); // Push empty string for failed image processing
        hadError = true; // Mark that at least one error occurred
        // We continue to the next image
      }
    }

    if (hadError && allExtractedTexts.every(text => text === '')) {
        // If all images resulted in an error or no text, return a general error
        return res.status(500).json({ error: 'Failed to process any images or extract text from them.', texts: allExtractedTexts });
    }

    res.json({ texts: allExtractedTexts }); // Return array of texts
  });

  return router;
} 