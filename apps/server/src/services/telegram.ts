import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import fs from 'fs';
import path from 'path';
import { ActionCard, AlphaDigestItem, QrAuthStatus, TelegramDialog } from '../types.js';
import { aiService } from './ai.js';

const SESSION_FILE_PATH = path.resolve(process.cwd(), 'session.txt');
const CONFIG_FILE_PATH = path.resolve(process.cwd(), 'vip_config.json');

interface VipConfig {
  vipChatIds: string[];
  digestChannelIds: string[];
}

export class LiveTelegramService {
  private client: TelegramClient | null = null;
  private apiId: number = 0;
  private apiHash: string = '';
  private sessionString: string = '';
  public isConnected: boolean = false;
  public currentUser: any = null;

  // QR Auth State
  private currentQrStatus: QrAuthStatus = { status: 'unauthenticated' };
  private qrLoginPromise: Promise<any> | null = null;
  private qrTokenWaiters: Array<(status: QrAuthStatus) => void> = [];
  private isQrSigningIn = false;

  // VIP Configuration
  private config: VipConfig = {
    vipChatIds: [],
    digestChannelIds: [],
  };

  constructor() {
    this.loadConfig();
    this.loadCredentials();
  }

  private loadCredentials() {
    this.apiId = parseInt(process.env.TELEGRAM_API_ID || '0', 10);
    this.apiHash = process.env.TELEGRAM_API_HASH || '';

    // Load session string from file or env
    if (fs.existsSync(SESSION_FILE_PATH)) {
      try {
        this.sessionString = fs.readFileSync(SESSION_FILE_PATH, 'utf-8').trim();
      } catch (err) {
        console.warn('[Telegram] Could not read session.txt:', err);
      }
    } else if (process.env.TELEGRAM_SESSION) {
      this.sessionString = process.env.TELEGRAM_SESSION.trim();
    }
  }

  private loadConfig() {
    if (fs.existsSync(CONFIG_FILE_PATH)) {
      try {
        const raw = fs.readFileSync(CONFIG_FILE_PATH, 'utf-8');
        this.config = JSON.parse(raw);
      } catch (e) {
        this.config = { vipChatIds: [], digestChannelIds: [] };
      }
    }
  }

  private saveConfig() {
    try {
      fs.writeFileSync(CONFIG_FILE_PATH, JSON.stringify(this.config, null, 2), 'utf-8');
    } catch (e) {
      console.error('[Telegram] Failed to save vip_config.json:', e);
    }
  }

  private saveSessionString(session: string) {
    this.sessionString = session;
    try {
      fs.writeFileSync(SESSION_FILE_PATH, session, 'utf-8');
      console.log('[Telegram] Saved MTProto session to session.txt');
    } catch (err) {
      console.error('[Telegram] Failed to write session.txt:', err);
    }
  }

  public async init() {
    this.loadCredentials();

    if (!this.apiId || !this.apiHash) {
      console.warn('[Telegram] TELEGRAM_API_ID or TELEGRAM_API_HASH not set. Telegram service is awaiting credentials.');
      return;
    }

    try {
      const stringSession = new StringSession(this.sessionString);
      this.client = new TelegramClient(stringSession, this.apiId, this.apiHash, {
        connectionRetries: 5,
        useWSS: false,
      });

      await this.client.connect();

      if (await this.client.checkAuthorization()) {
        this.currentUser = await this.client.getMe();
        this.isConnected = true;
        this.currentQrStatus = {
          status: 'authenticated',
          user: {
            id: this.currentUser.id?.toString(),
            username: this.currentUser.username,
            firstName: this.currentUser.firstName,
            lastName: this.currentUser.lastName,
            phone: this.currentUser.phone,
          },
        };
        console.log(`[Telegram] Successfully connected MTProto as @${this.currentUser.username || this.currentUser.firstName} (${this.currentUser.id})`);
      } else {
        this.isConnected = false;
        this.currentQrStatus = { status: 'unauthenticated' };
        console.log('[Telegram] Client connected but not authorized. Ready for QR or phone login.');
      }
    } catch (err) {
      console.error('[Telegram] Connection error:', err);
      this.isConnected = false;
    }
  }

  private ensureClient(): TelegramClient {
    if (!this.apiId || !this.apiHash) {
      throw new Error('Telegram credentials missing. Set TELEGRAM_API_ID and TELEGRAM_API_HASH in apps/server/.env');
    }
    if (!this.client) {
      const stringSession = new StringSession(this.sessionString);
      this.client = new TelegramClient(stringSession, this.apiId, this.apiHash, {
        connectionRetries: 5,
      });
    }
    return this.client;
  }

  public getStatus() {
    return {
      configured: Boolean(this.apiId && this.apiHash),
      connected: this.isConnected,
      user: this.currentUser
        ? {
            id: this.currentUser.id?.toString(),
            username: this.currentUser.username,
            firstName: this.currentUser.firstName,
            phone: this.currentUser.phone,
          }
        : null,
      vipChatsCount: this.config.vipChatIds.length,
      digestChannelsCount: this.config.digestChannelIds.length,
      sessionSaved: Boolean(this.sessionString),
    };
  }

  /**
   * Start Live Telegram QR Login flow
   */
  public async startQrLogin(): Promise<QrAuthStatus> {
    const client = this.ensureClient();
    await client.connect();

    if (await client.checkAuthorization()) {
      this.currentUser = await client.getMe();
      this.isConnected = true;
      this.currentQrStatus = {
        status: 'authenticated',
        user: {
          id: this.currentUser.id?.toString(),
          username: this.currentUser.username,
          firstName: this.currentUser.firstName,
        },
      };
      return this.currentQrStatus;
    }

    // If we already have a valid unexpired QR token, return it immediately
    const nowSec = Math.floor(Date.now() / 1000);
    if (
      this.isQrSigningIn &&
      this.currentQrStatus.status === 'waiting_qr' &&
      this.currentQrStatus.qrUrl &&
      this.currentQrStatus.expiresIn &&
      this.currentQrStatus.expiresIn > nowSec + 4
    ) {
      return this.currentQrStatus;
    }

    // Create a promise to wait for the first or refreshed qrCode token from Telegram DC
    const tokenPromise = new Promise<QrAuthStatus>((resolve) => {
      const timer = setTimeout(() => {
        resolve(this.currentQrStatus);
      }, 7000);

      this.qrTokenWaiters.push((status) => {
        clearTimeout(timer);
        resolve(status);
      });
    });

    // If QR loop is not already running, initiate it
    if (!this.isQrSigningIn) {
      this.isQrSigningIn = true;
      this.currentQrStatus = { status: 'waiting_qr' };

      this.qrLoginPromise = client
        .signInUserWithQrCode(
          { apiId: this.apiId, apiHash: this.apiHash },
          {
            qrCode: async (code) => {
              const tokenBase64 = Buffer.from(code.token).toString('base64url');
              const qrUrl = `tg://login?token=${tokenBase64}`;
              this.currentQrStatus = {
                status: 'waiting_qr',
                qrUrl,
                expiresIn: code.expires,
              };
              console.log('[Telegram QR] Generated token, expires at:', new Date(code.expires * 1000).toLocaleTimeString());
              const waiters = [...this.qrTokenWaiters];
              this.qrTokenWaiters = [];
              waiters.forEach((cb) => cb(this.currentQrStatus));
            },
            onError: (err: any) => {
              console.error('[Telegram QR Error]', err);
              this.currentQrStatus = {
                status: 'error',
                error: err.message || 'QR Login error',
              };
              const waiters = [...this.qrTokenWaiters];
              this.qrTokenWaiters = [];
              waiters.forEach((cb) => cb(this.currentQrStatus));
            },
          }
        )
        .then(async (user: any) => {
          this.currentUser = user;
          this.isConnected = true;
          this.isQrSigningIn = false;
          const savedSession = client.session.save() as unknown as string;
          this.saveSessionString(savedSession);
          this.currentQrStatus = {
            status: 'authenticated',
            user: {
              id: user.id?.toString(),
              username: user.username,
              firstName: user.firstName,
              lastName: user.lastName,
              phone: user.phone,
            },
          };
          console.log('[Telegram QR] Successfully signed in via QR code!');
          const waiters = [...this.qrTokenWaiters];
          this.qrTokenWaiters = [];
          waiters.forEach((cb) => cb(this.currentQrStatus));
        })
        .catch((err: any) => {
          console.error('[Telegram QR Failed]', err);
          this.isQrSigningIn = false;
          this.currentQrStatus = {
            status: 'error',
            error: err.message || 'QR Login Failed',
          };
          const waiters = [...this.qrTokenWaiters];
          this.qrTokenWaiters = [];
          waiters.forEach((cb) => cb(this.currentQrStatus));
        });
    }

    return await tokenPromise;
  }

  public getQrStatus(): QrAuthStatus {
    return this.currentQrStatus;
  }

  /**
   * Phone number login fallback
   */
  public async sendPhoneCode(phoneNumber: string): Promise<{ phoneCodeHash: string }> {
    const client = this.ensureClient();
    await client.connect();
    const result = await client.sendCode(
      { apiId: this.apiId, apiHash: this.apiHash },
      phoneNumber
    );
    return { phoneCodeHash: result.phoneCodeHash };
  }

  public async signInWithPhone(params: {
    phoneNumber: string;
    phoneCodeHash: string;
    phoneCode: string;
    password?: string;
  }): Promise<{ success: boolean; user: any }> {
    const client = this.ensureClient();
    await client.connect();

    try {
      const user = await client.signInUser(
        { apiId: this.apiId, apiHash: this.apiHash },
        {
          phoneNumber: params.phoneNumber,
          phoneCode: async () => params.phoneCode,
          onError: (err: any) => {
            console.error('[Phone Auth Error]', err);
          },
        }
      );

      this.currentUser = user;
      this.isConnected = true;
      const saved = client.session.save() as unknown as string;
      this.saveSessionString(saved);
      return { success: true, user };
    } catch (err: any) {
      if (err.message && err.message.includes('SESSION_PASSWORD_NEEDED') && params.password) {
        const user = await client.signInWithPassword(
          { apiId: this.apiId, apiHash: this.apiHash },
          {
            password: async () => params.password || '',
            onError: (pErr: any) => {
              console.error('[Password Auth Error]', pErr);
            },
          }
        );
        this.currentUser = user;
        this.isConnected = true;
        const saved = client.session.save() as unknown as string;
        this.saveSessionString(saved);
        return { success: true, user };
      }
      throw err;
    }
  }

  /**
   * Fetch Real Dialogs / Chats from Telegram
   */
  public async getDialogs(): Promise<TelegramDialog[]> {
    if (!this.isConnected || !this.client) {
      throw new Error('Telegram is not connected. Authenticate first.');
    }

    const dialogs = await this.client.getDialogs({ limit: 50 });
    return dialogs.map((d: any) => {
      const id = d.id?.toString() || '';
      const isUser = Boolean(d.isUser);
      const isChannel = Boolean(d.isChannel);
      const type = isUser ? 'user' : isChannel ? 'channel' : 'group';

      return {
        id,
        title: d.title || d.name || 'Telegram Contact',
        type,
        unreadCount: d.unreadCount || 0,
        isVip: this.config.vipChatIds.includes(id),
        isDigest: this.config.digestChannelIds.includes(id),
        lastMessage: d.message?.message || '',
        date: d.date,
      };
    });
  }

  public updateVipConfig(vipChatIds: string[], digestChannelIds: string[]): VipConfig {
    this.config.vipChatIds = vipChatIds.slice(0, 5);
    this.config.digestChannelIds = digestChannelIds.slice(0, 5);
    this.saveConfig();
    return this.config;
  }

  public getVipConfig(): VipConfig {
    return this.config;
  }

  /**
   * Pull Real Unread Messages from Selected VIP Chats and Triage via Groq Llama 3.1
   */
  public async getActionQueue(): Promise<ActionCard[]> {
    if (!this.isConnected || !this.client) {
      throw new Error('Telegram is not connected. Open the phone companion to pair Telegram.');
    }

    if (this.config.vipChatIds.length === 0) {
      return [];
    }

    const cards: ActionCard[] = [];

    for (const chatId of this.config.vipChatIds) {
      try {
        const dialogs = await this.client.getDialogs({ limit: 50 });
        const targetDialog = dialogs.find((d: any) => d.id?.toString() === chatId);

        if (!targetDialog || targetDialog.unreadCount === 0) {
          continue;
        }

        // Fetch recent unread messages
        const fetchLimit = Math.min(targetDialog.unreadCount || 1, 5);
        const messages = await this.client.getMessages(chatId, { limit: fetchLimit });

        // Get the latest incoming message
        const incoming = messages.find((m: any) => !m.out && m.message && m.message.trim() !== '');
        if (!incoming) {
          continue;
        }

        const senderEntity: any = incoming.sender;
        const senderName = senderEntity?.firstName || senderEntity?.title || targetDialog.title || 'Telegram User';
        const rawText = incoming.message;
        const timestamp = new Date((incoming.date || Date.now() / 1000) * 1000).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        });

        const chatTitle = targetDialog.title || 'Telegram Chat';

        // Live triage via Groq Llama 3.1
        const triage = await aiService.triageMessage(senderName, chatTitle, rawText);

        cards.push({
          id: `card-${incoming.id}`,
          sender: senderName,
          chatTitle,
          chatId,
          replyToMsgId: incoming.id,
          timestamp,
          summary: triage.summary || rawText.slice(0, 80),
          smartReplies: triage.smartReplies || [],
          rawText,
          unreadCount: targetDialog.unreadCount || 1,
        });
      } catch (err) {
        console.error(`[Telegram] Error fetching queue for chat ${chatId}:`, err);
      }
    }

    return cards;
  }

  /**
   * Send Live Telegram Reply & Mark Chat as Read
   */
  public async sendReply(chatId: string, replyText: string, replyToMsgId?: number): Promise<{ success: boolean; message: string }> {
    if (!this.isConnected || !this.client) {
      throw new Error('Telegram is not connected.');
    }

    const options: any = { message: replyText };
    if (replyToMsgId) {
      options.replyTo = replyToMsgId;
    }

    await this.client.sendMessage(chatId, options);
    await this.client.markAsRead(chatId);

    console.log(`[Telegram] Live reply sent to ${chatId}: "${replyText}"`);
    return { success: true, message: `Reply sent to Telegram chat ${chatId}` };
  }

  /**
   * Fetch Real Recent Channel Posts and Summarize via Groq Llama 3.1
   */
  public async getChannelDigest(): Promise<AlphaDigestItem> {
    if (!this.isConnected || !this.client) {
      throw new Error('Telegram is not connected.');
    }

    if (this.config.digestChannelIds.length === 0) {
      throw new Error('No Digest channels selected. Pick up to 5 channels on your phone companion.');
    }

    const channelPosts: string[] = [];
    let primaryChannelTitle = 'Channels';

    for (const channelId of this.config.digestChannelIds) {
      try {
        const messages = await this.client.getMessages(channelId, { limit: 3 });
        const dialogs = await this.client.getDialogs({ limit: 50 });
        const ch = dialogs.find((d: any) => d.id?.toString() === channelId);
        if (ch && ch.title) primaryChannelTitle = ch.title;

        for (const m of messages) {
          if (m.message && m.message.trim().length > 10) {
            channelPosts.push(`[${ch?.title || 'Channel'}]: ${m.message.trim()}`);
          }
        }
      } catch (err) {
        console.error(`[Telegram] Error fetching messages for channel ${channelId}:`, err);
      }
    }

    if (channelPosts.length === 0) {
      return {
        id: 'digest-empty',
        channelTitle: primaryChannelTitle,
        bullets: ['No recent posts found in selected channels.'],
        timestamp: new Date().toLocaleTimeString(),
      };
    }

    const bullets = await aiService.summarizeChannelPosts(primaryChannelTitle, channelPosts);

    return {
      id: `digest-${Date.now()}`,
      channelTitle: primaryChannelTitle,
      bullets,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
  }

  /**
   * Save Digest to Telegram "Saved Messages" ("me")
   */
  public async saveToSavedMessages(content: string): Promise<{ success: boolean; message: string }> {
    if (!this.isConnected || !this.client) {
      throw new Error('Telegram is not connected.');
    }

    const messageText = `🔖 [BriefTap Digest Bookmark]\n\n${content}`;
    await this.client.sendMessage('me', { message: messageText });
    return { success: true, message: 'Saved to Telegram Saved Messages' };
  }
}

export const telegramService = new LiveTelegramService();
