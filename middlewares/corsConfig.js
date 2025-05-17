import cors from 'cors';

const envFrontendOrigin = process.env.FRONTEND_ORIGIN;

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

const corsOptions = {
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
};

export default cors(corsOptions); 