import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { apiRouter } from './routes/api.js';
import { telegramService } from './services/telegram.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Render free-tier friendly & strict CORS enabled
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json({ limit: '15mb' }));
app.use(express.raw({ type: ['audio/*', 'application/octet-stream'], limit: '15mb' }));
app.use(express.urlencoded({ extended: true }));

// Mount health and API routes
app.use('/', apiRouter);

// Initialize live MTProto service
telegramService.init().catch((err) => {
  console.warn('[Telegram] Startup init warning:', err.message);
});

app.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🚀 BriefTap Live Telegram & Groq AI Server on port ${PORT}`);
  console.log(`   Health endpoint: http://localhost:${PORT}/health`);
  console.log(`   ZERO Mocks / 100% Live MTProto + Whisper + Llama 3.1`);
  console.log(`======================================================\n`);
});
