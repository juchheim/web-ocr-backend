import express from 'express';
import upload from '../middlewares/multerConfig.js';
import { protect as protectRoute } from './auth.js'; // Import the protect middleware

// Helper function to generate the asset URL
function generateAssetUrl(assetTagString) {
  if (!assetTagString || typeof assetTagString !== 'string') {
    return null;
  }
  const trimmedTag = assetTagString.trim();
  // Ensure the trimmed tag is not empty and consists only of digits
  if (trimmedTag === '' || !/^\d+$/.test(trimmedTag)) {
    return null;
  }

  // ParseInt will handle leading zeros correctly for normalization (e.g., "00123" -> 123)
  const numericValue = parseInt(trimmedTag, 10);

  // This check is mostly redundant due to the regex, but good for absolute safety with parseInt behavior
  if (isNaN(numericValue)) {
     return null;
  }

  const normalizedForPadding = String(numericValue); // Convert back to string for padding

  const baseUrl = "https://humphreys.camarathon.net/MarathonWeb/FA/Activities/Assets/AssetMain.aspx?FormAction=Edit&AssetNo=";
  const paddedTag = normalizedForPadding.padStart(12, '0'); // Pad to 12 digits
  return `${baseUrl}${paddedTag}&SortGrid=AssetNo&ItemFilterID=170851`;
}

// This function accepts the openai client and db instance as arguments
export default function createOcrRoutes(openai, db) {
  const router = express.Router();

  // Apply protectRoute middleware before the multer upload and the main route handler
  router.post('/extract-text', protectRoute, upload.array('photos'), async (req, res) => {
    // The req.user object will be available here if authentication is successful
    // console.log('Authenticated user:', req.user);

    if (!req.files?.length) {
      return res.status(400).json({ error: 'No photos uploaded.' });
    }

    const allExtractedTexts = [];
    let hadError = false;

    for (const file of req.files) {
      try {
        const base64 = file.buffer.toString('base64');
        const dataUrl = `data:${file.mimetype};base64,${base64}`;
        
        // Get capture detail from request body, default to 'low' if not provided or invalid
        const requestedDetail = req.body.captureDetail;
        const imageDetail = (requestedDetail === 'high' || requestedDetail === 'low') ? requestedDetail : 'auto'; // Use 'auto' as a safe default

        const imagePayload = [{ type: 'image_url', image_url: { url: dataUrl, detail: imageDetail } }];

        const openAiPayload = {
          model: 'gpt-4.1-nano',
          max_tokens: 2048, // Max tokens per image analysis
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: 'Scan the image for an asset tag number. Asset tag numbers are numerical identifiers, typically 5 digits long, not counting leading zeros. Extract the sequence of digits that represents the asset tag, including any leading zeros if they appear to be part of the tag. IMPORTANT: If there is no clear asset tag number visible in the image, or if the image does not contain any numbers, return an empty string. Do not guess or invent a number. ONLY RETURN THE ASSET TAG NUMBER or an empty string.' },
                ...imagePayload, // Send only one image at a time
              ],
            },
          ],
        };

        console.log(`Processing one image. Using OpenAI model: ${openAiPayload.model}`);
        // console.log('Sending one image to OpenAI:', JSON.stringify(openAiPayload, null, 2)); // Can be verbose for multiple images

        const completion = await openai.chat.completions.create(openAiPayload);
        const assetTagFromAI = completion.choices?.[0]?.message?.content || ''; // Get raw response
        allExtractedTexts.push(assetTagFromAI.trim()); // Add trimmed version to results for frontend

        let potentialAssetTag = assetTagFromAI.trim(); // This is what AI returned, trimmed
        // Aggressively remove any quote characters (single or double) that the AI might have added
        potentialAssetTag = potentialAssetTag.replace(/["']/g, '').trim();

        const roomNumberFromBody = req.body.roomNumber ? req.body.roomNumber.trim() : null;

        if (potentialAssetTag !== '') { // Only attempt to process if AI returned some non-empty (after trim and quote removal) text
          const assetUrl = generateAssetUrl(potentialAssetTag); // Validates and generates URL

          if (assetUrl) { // If URL is successfully generated, it means potentialAssetTag was a valid numeric string
            try {
              const assetTagsCollection = db.collection('asset_tags');
              const docToInsert = {
                assetTag: potentialAssetTag, // Store the numeric string as captured (and trimmed)
                assetUrl: assetUrl, // Store the generated URL
                scannedAt: new Date(),
                sourceImageOriginalName: file.originalname, // Optional: store original filename
                userId: req.user.id, // Associate with the logged-in user
                userEmail: req.user.email // Store user's email for convenience
              };

              if (roomNumberFromBody) {
                docToInsert.roomNumber = roomNumberFromBody;
              }

              const result = await assetTagsCollection.insertOne(docToInsert);
              let logMessage = `Asset tag '${potentialAssetTag}' (URL: ${assetUrl})`;
              if (roomNumberFromBody) {
                logMessage += ` for room '${roomNumberFromBody}'`;
              }
              logMessage += ` from image '${file.originalname || 'unknown'}' saved to MongoDB with id: ${result.insertedId}`;
              console.log(logMessage);
            } catch (dbErr) {
              console.error("Error saving asset tag to MongoDB:", dbErr);
              // Continue processing other images even if one DB save fails
            }
          } else {
            // assetUrl is null, meaning potentialAssetTag was not a valid numeric asset tag string (e.g., "No tag found")
            console.log(`Skipping save for invalid or non-numeric asset tag: '${potentialAssetTag}' from image '${file.originalname || 'unknown'}'`);
          }
        } // If potentialAssetTag was empty (AI returned empty or whitespace), it's correctly skipped
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