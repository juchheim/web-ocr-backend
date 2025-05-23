import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Determine __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '.env') });

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  console.error("CRITICAL: GEMINI_API_KEY is not defined in .env or not loaded.");
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(apiKey);

// Function to convert file to generative part
function fileToGenerativePart(filePath, mimeType) {
  try {
    const fullPath = path.resolve(__dirname, filePath);
    if (!fs.existsSync(fullPath)) {
      console.error(`Error: Image file not found at ${fullPath}`);
      return null;
    }
    return {
      inlineData: {
        data: Buffer.from(fs.readFileSync(fullPath)).toString("base64"),
        mimeType
      },
    };
  } catch (err) {
    console.error(`Error reading image file ${filePath}:`, err);
    return null;
  }
}

async function runTest() {
  try {
    // For gemini-pro-vision, or other multimodal models
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-preview-05-20" });

    const prompt = "What is in this image?";
    
    // IMPORTANT: Replace 'test_image.jpg' and 'image/jpeg' if your test image is different
    const imagePath = 'test_image.jpg'; 
    const imageMimeType = 'image/jpeg'; // Use 'image/png' for PNG files

    const imagePart = fileToGenerativePart(imagePath, imageMimeType);

    if (!imagePart) {
      console.log("Exiting due to image loading error.");
      return;
    }

    console.log(`Attempting to generate content with model 'gemini-2.5-flash-preview-05-20' using image ${imagePath}...`);

    const result = await model.generateContent([prompt, imagePart]);
    const response = result.response;
    const text = response.text();
    console.log("Successfully received response from Gemini:");
    console.log(text);

  } catch (e) {
    console.error("Error during Gemini API call in test script:", e);
    if (e.errorDetails) {
        console.error("Gemini Error Details:", JSON.stringify(e.errorDetails, null, 2));
    }
  }
}

runTest(); 