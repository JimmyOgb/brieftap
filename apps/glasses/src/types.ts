export type GlassesViewMode =
  | 'QUEUE'
  | 'VOICE_CAPTURE'
  | 'VOICE_CONFIRM'
  | 'DIGEST'
  | 'EMPTY'
  | 'AUTH_REQUIRED'
  | 'ERROR';

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

export interface VoiceIntentResult {
  transcription: string;
  polishedReply: string;
}

export interface GlassesState {
  currentView: GlassesViewMode;
  currentCardIndex: number;
  cards: ActionCard[];
  digest: AlphaDigestItem | null;
  isRecording: boolean;
  recordedPcmBytes: number;
  pendingVoiceResult: VoiceIntentResult | null;
  statusMessage: string;
  errorMessage: string | null;
  isTelegramAuthenticated: boolean;
  isGroqConfigured: boolean;
}
