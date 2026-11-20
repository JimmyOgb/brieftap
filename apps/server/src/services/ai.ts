import Groq from 'groq-sdk';
import { pcmToWav } from '../utils/wav.js';
import { VoiceIntentResult } from '../types.js';

export class LiveAiService {
  private groq: Groq | null = null;
  private chatModel: string = process.env.GROQ_CHAT_MODEL || 'qwen/qwen3.8-27b';

  constructor() {
    this.initClient();
  }

  private initClient() {
    const apiKey = process.env.GROQ_API_KEY;
    if (apiKey && apiKey.trim() !== '') {
      this.groq = new Groq({ apiKey: apiKey.trim() });
    } else {
      this.groq = null;
    }
  }

  private getClient(): Groq {
    if (!this.groq) {
      this.initClient();
    }
    if (!this.groq) {
      throw new Error(
        'GROQ_API_KEY is missing. Please add your free-tier Groq API key to apps/server/.env to enable live voice transcription and smart replies.'
      );
    }
    return this.groq;
  }

  public isConfigured(): boolean {
    return Boolean(process.env.GROQ_API_KEY && process.env.GROQ_API_KEY.trim() !== '');
  }

  private async executeChat(params: any): Promise<any> {
    const groq = this.getClient();
    try {
      return await groq.chat.completions.create({
        ...params,
        model: this.chatModel,
      });
    } catch (err: any) {
      if (err.message && err.message.includes('model_not_found') && this.chatModel !== 'qwen/qwen3.8-27b') {
        console.warn(`[AI] Model ${this.chatModel} not found on Groq, switching to qwen/qwen3.8-27b`);
        this.chatModel = 'qwen/qwen3.8-27b';
        return await groq.chat.completions.create({
          ...params,
          model: this.chatModel,
        });
      }
      throw err;
    }
  }

  /**
   * Live Audio Transcription (Whisper Large v3 Turbo) + Voice Intent Expansion (Llama 3.1 8B Instant)
   */
  async processVoiceIntent(
    audioBuffer: Buffer,
    isRawPcm: boolean,
    contextMessage?: string,
    sender?: string
  ): Promise<VoiceIntentResult> {
    const groq = this.getClient();

    if (!audioBuffer || audioBuffer.length === 0) {
      throw new Error('Empty audio buffer received from G2 microphone.');
    }

    const wavBuffer = isRawPcm ? pcmToWav(audioBuffer) : audioBuffer;
    const file = new File([wavBuffer], 'voice_intent.wav', { type: 'audio/wav' });

    // 1. Live transcription via Groq Whisper Large v3 Turbo
    const transcriptionRes = await groq.audio.transcriptions.create({
      file,
      model: 'whisper-large-v3-turbo',
      temperature: 0.0,
      response_format: 'json',
    });

    const transcription = transcriptionRes.text?.trim();
    if (!transcription) {
      throw new Error('No speech detected in audio stream.');
    }

    // 2. Live voice intent expansion via Llama 3.1 8B Instant
    const systemPrompt = `You are BriefTap on Even Realities G2 smart glasses.
The user spoke a rapid 2-4 word intent on their glasses temple mic to reply to a Telegram message.
Your job: expand it into a clean, crisp, natural Telegram reply (strictly 1 short sentence, under 12 words).
Rules:
- Strictly output ONLY the reply text itself.
- Do NOT include quotation marks, markdown, or conversational filler like "Here is your reply".
- Maintain a polite, professional, concise tone.`;

    const userPrompt = contextMessage
      ? `Incoming message from ${sender || 'contact'}: "${contextMessage}"\nUser's spoken intent: "${transcription}"`
      : `User's spoken intent: "${transcription}"`;

    const completion = await this.executeChat({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: 30,
    });

    const polishedReply = completion.choices[0]?.message?.content?.trim() || transcription;

    return {
      transcription,
      polishedReply,
    };
  }

  /**
   * Live Message Triage via Llama 3.1 8B Instant
   * Produces 1-2 line crisp decision summary + 3 short smart replies (under 8 words each)
   */
  async triageMessage(
    sender: string,
    chatTitle: string,
    rawText: string
  ): Promise<{ summary: string; smartReplies: string[] }> {
    const groq = this.getClient();

    const response = await this.executeChat({
      messages: [
        {
          role: 'system',
          content: `You summarize incoming Telegram messages for a 576x288 monochrome optical display.
Return a valid JSON object matching this schema:
{
  "summary": "1-2 line crisp summary of what requires a decision (max 85 chars)",
  "smartReplies": ["3 short actionable replies under 7 words each"]
}
Strictly output JSON only.`,
        },
        {
          role: 'user',
          content: `Sender: ${sender}\nChat: ${chatTitle}\nMessage: "${rawText}"`,
        },
      ],
      temperature: 0.2,
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('Groq returned empty triage content.');
    }

    const parsed = JSON.parse(content);
    return {
      summary: parsed.summary || rawText.slice(0, 80),
      smartReplies: Array.isArray(parsed.smartReplies) ? parsed.smartReplies.slice(0, 3) : [],
    };
  }

  /**
   * Live Channel Digest Summarization via Llama 3.1 8B Instant
   * Summarizes recent real channel posts into 3 high-impact bullets.
   */
  async summarizeChannelPosts(channelTitle: string, posts: string[]): Promise<string[]> {
    const groq = this.getClient();

    if (posts.length === 0) {
      return ['No recent channel posts found.'];
    }

    const formattedPosts = posts.map((p, i) => `[Post ${i + 1}]: ${p}`).join('\n\n');

    const response = await this.executeChat({
      messages: [
        {
          role: 'system',
          content: `You are an executive crypto/tech news editor for smart glasses.
Summarize the channel posts into exactly 3 high-signal, punchy bullet points (max 14 words per bullet).
Return a valid JSON object with:
{
  "bullets": ["Bullet 1", "Bullet 2", "Bullet 3"]
}
Strictly output JSON only.`,
        },
        {
          role: 'user',
          content: `Channel: "${channelTitle}"\n\nRecent Posts:\n${formattedPosts}`,
        },
      ],
      temperature: 0.2,
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('Groq returned empty digest content.');
    }

    const parsed = JSON.parse(content);
    return Array.isArray(parsed.bullets) ? parsed.bullets.slice(0, 3) : ['Could not summarize channel posts.'];
  }
}

export const aiService = new LiveAiService();
