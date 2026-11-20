import { Router, Request, Response } from 'express';
import multer from 'multer';
import { telegramService } from '../services/telegram.js';
import { aiService } from '../services/ai.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

export const apiRouter = Router();

/**
 * Health check endpoint
 */
apiRouter.get('/health', (req: Request, res: Response) => {
  const tg = telegramService.getStatus();
  const aiReady = aiService.isConfigured();

  res.json({
    status: 'ok',
    service: 'brieftap-server',
    live: true,
    telegram: {
      configured: tg.configured,
      connected: tg.connected,
      user: tg.user,
      sessionSaved: tg.sessionSaved,
    },
    groq: {
      configured: aiReady,
    },
    vipChatsCount: tg.vipChatsCount,
    digestChannelsCount: tg.digestChannelsCount,
    timestamp: new Date().toISOString(),
  });
});

/**
 * Live Telegram QR Login Flow
 */
apiRouter.post('/api/auth/qr/start', async (req: Request, res: Response) => {
  try {
    const status = await telegramService.startQrLogin();
    res.json(status);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to start QR login' });
  }
});

apiRouter.get('/api/auth/qr/status', (req: Request, res: Response) => {
  res.json(telegramService.getQrStatus());
});

/**
 * Phone Number Login Fallback
 */
apiRouter.post('/api/auth/phone/send-code', async (req: Request, res: Response) => {
  try {
    const { phoneNumber } = req.body;
    if (!phoneNumber) {
      res.status(400).json({ error: 'phoneNumber is required' });
      return;
    }
    const result = await telegramService.sendPhoneCode(phoneNumber);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to send phone code' });
  }
});

apiRouter.post('/api/auth/phone/verify', async (req: Request, res: Response) => {
  try {
    const { phoneNumber, phoneCodeHash, phoneCode, password } = req.body;
    if (!phoneNumber || !phoneCodeHash || !phoneCode) {
      res.status(400).json({ error: 'phoneNumber, phoneCodeHash, and phoneCode are required' });
      return;
    }
    const result = await telegramService.signInWithPhone({
      phoneNumber,
      phoneCodeHash,
      phoneCode,
      password,
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Verification failed' });
  }
});

/**
 * Dialogs & VIP Configuration
 */
apiRouter.get('/api/chats', async (req: Request, res: Response) => {
  try {
    const chats = await telegramService.getDialogs();
    res.json({ chats });
  } catch (err: any) {
    res.status(err.message.includes('not connected') ? 401 : 500).json({ error: err.message });
  }
});

apiRouter.get('/api/vip/config', (req: Request, res: Response) => {
  res.json(telegramService.getVipConfig());
});

apiRouter.post('/api/vip/configure', (req: Request, res: Response) => {
  const { vipChatIds, digestChannelIds } = req.body;
  if (!Array.isArray(vipChatIds) || !Array.isArray(digestChannelIds)) {
    res.status(400).json({ error: 'vipChatIds and digestChannelIds arrays required' });
    return;
  }
  const config = telegramService.updateVipConfig(vipChatIds, digestChannelIds);
  res.json(config);
});

/**
 * Live Action Queue (Unread VIP messages triaged via Groq Llama 3.1)
 */
apiRouter.get('/api/queue', async (req: Request, res: Response) => {
  try {
    const queue = await telegramService.getActionQueue();
    res.json({ queue });
  } catch (err: any) {
    res.status(err.message.includes('not connected') ? 401 : 500).json({ error: err.message });
  }
});

/**
 * Send Live Reply to Telegram (1-Tap Write)
 */
apiRouter.post('/api/reply', async (req: Request, res: Response) => {
  try {
    const { chatId, replyText, replyToMsgId } = req.body;
    if (!chatId || !replyText) {
      res.status(400).json({ error: 'chatId and replyText are required' });
      return;
    }
    const result = await telegramService.sendReply(chatId, replyText, replyToMsgId);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to send reply' });
  }
});

/**
 * Live Voice Intent Processing (G2 4-mic 16kHz PCM -> Whisper -> Llama 3.1)
 */
apiRouter.post('/api/voice-intent', upload.single('audio'), async (req: Request, res: Response) => {
  try {
    let audioBuffer: Buffer | null = null;
    let isRawPcm = true;
    let contextMessage = req.body?.contextMessage;
    let sender = req.body?.sender;

    if (req.file) {
      audioBuffer = req.file.buffer;
      isRawPcm = !req.file.originalname.endsWith('.wav');
    } else if (req.body?.audioBase64) {
      audioBuffer = Buffer.from(req.body.audioBase64, 'base64');
      isRawPcm = req.body.isRawPcm ?? true;
    } else if (Buffer.isBuffer(req.body)) {
      audioBuffer = req.body;
    }

    if (!audioBuffer || audioBuffer.length === 0) {
      res.status(400).json({ error: 'No audio data received' });
      return;
    }

    const result = await aiService.processVoiceIntent(audioBuffer, isRawPcm, contextMessage, sender);
    res.json(result);
  } catch (err: any) {
    console.error('[API Voice Intent Error]', err);
    res.status(500).json({ error: err.message || 'Voice intent processing failed' });
  }
});

/**
 * Live Channel Alpha Digest
 */
apiRouter.get('/api/digest', async (req: Request, res: Response) => {
  try {
    const digest = await telegramService.getChannelDigest();
    res.json({ digest });
  } catch (err: any) {
    res.status(err.message.includes('not connected') ? 401 : 500).json({ error: err.message });
  }
});

/**
 * Save Digest Bullet to Telegram Saved Messages ("me")
 */
apiRouter.post('/api/digest/save', async (req: Request, res: Response) => {
  try {
    const { bulletText } = req.body;
    if (!bulletText) {
      res.status(400).json({ error: 'bulletText is required' });
      return;
    }
    const result = await telegramService.saveToSavedMessages(bulletText);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to save to Saved Messages' });
  }
});
