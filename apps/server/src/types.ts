export interface ActionCard {
  id: string;
  sender: string;
  chatTitle: string;
  chatId: string;
  replyToMsgId?: number;
  timestamp: string;
  summary: string;
  smartReplies: string[];
  rawText: string;
  unreadCount: number;
}

export interface AlphaDigestItem {
  id: string;
  channelTitle: string;
  bullets: string[];
  timestamp: string;
}

export interface VoiceIntentResult {
  transcription: string;
  polishedReply: string;
  contextChatId?: string;
}

export interface TelegramDialog {
  id: string;
  title: string;
  type: 'user' | 'group' | 'channel';
  unreadCount: number;
  isVip: boolean;
  isDigest: boolean;
  lastMessage?: string;
  date?: number;
}

export interface QrAuthStatus {
  status: 'waiting_qr' | 'authenticated' | 'expired' | 'error' | 'unauthenticated';
  qrUrl?: string;
  expiresIn?: number;
  error?: string;
  user?: {
    id: string;
    username?: string;
    firstName?: string;
    lastName?: string;
    phone?: string;
  };
}
