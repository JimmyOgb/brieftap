import { ActionCard, AlphaDigestItem, TelegramDialog, VoiceIntentResult } from '../types';

const API_BASE = import.meta.env.VITE_API_URL || '';

export async function fetchHealth(): Promise<{
  status: string;
  telegram: { configured: boolean; connected: boolean; user?: any; sessionSaved: boolean };
  groq: { configured: boolean };
  vipChatsCount: number;
  digestChannelsCount: number;
}> {
  const res = await fetch(`${API_BASE}/health`);
  if (!res.ok) {
    throw new Error(`Server health check failed: HTTP ${res.status}`);
  }
  return await res.json();
}

export async function startQrAuth(): Promise<{ status: string; qrUrl?: string; expiresIn?: number; error?: string }> {
  const res = await fetch(`${API_BASE}/api/auth/qr/start`, { method: 'POST' });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to start QR auth');
  }
  return data;
}

export async function getQrAuthStatus(): Promise<{ status: string; qrUrl?: string; user?: any; error?: string }> {
  const res = await fetch(`${API_BASE}/api/auth/qr/status`);
  return await res.json();
}

export async function sendPhoneCode(phoneNumber: string): Promise<{ phoneCodeHash: string }> {
  const res = await fetch(`${API_BASE}/api/auth/phone/send-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phoneNumber }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to send phone code');
  return data;
}

export async function verifyPhoneCode(params: {
  phoneNumber: string;
  phoneCodeHash: string;
  phoneCode: string;
  password?: string;
}): Promise<{ success: boolean; user: any }> {
  const res = await fetch(`${API_BASE}/api/auth/phone/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Phone verification failed');
  return data;
}

export async function fetchChats(): Promise<TelegramDialog[]> {
  const res = await fetch(`${API_BASE}/api/chats`);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to fetch Telegram chats');
  }
  return data.chats || [];
}

export async function fetchVipConfig(): Promise<{ vipChatIds: string[]; digestChannelIds: string[] }> {
  const res = await fetch(`${API_BASE}/api/vip/config`);
  return await res.json();
}

export async function saveVipConfig(
  vipChatIds: string[],
  digestChannelIds: string[]
): Promise<{ vipChatIds: string[]; digestChannelIds: string[] }> {
  const res = await fetch(`${API_BASE}/api/vip/configure`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vipChatIds, digestChannelIds }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to save VIP configuration');
  return data;
}

export async function fetchQueue(): Promise<ActionCard[]> {
  const res = await fetch(`${API_BASE}/api/queue`);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to fetch action queue');
  }
  return data.queue || [];
}

export async function sendReply(
  chatId: string,
  replyText: string,
  replyToMsgId?: number
): Promise<{ success: boolean; message: string }> {
  const res = await fetch(`${API_BASE}/api/reply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chatId, replyText, replyToMsgId }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to send reply to Telegram');
  return data;
}

export async function sendVoiceIntent(
  audioBase64: string,
  isRawPcm: boolean = true,
  contextMessage?: string,
  sender?: string
): Promise<VoiceIntentResult> {
  const res = await fetch(`${API_BASE}/api/voice-intent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ audioBase64, isRawPcm, contextMessage, sender }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Voice intent processing failed on Groq API');
  return data;
}

export async function fetchDigest(): Promise<AlphaDigestItem> {
  const res = await fetch(`${API_BASE}/api/digest`);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to fetch channel digest');
  }
  return data.digest;
}

export async function saveDigest(bulletText: string): Promise<{ success: boolean; message: string }> {
  const res = await fetch(`${API_BASE}/api/digest/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bulletText }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to save digest to Telegram Saved Messages');
  return data;
}
