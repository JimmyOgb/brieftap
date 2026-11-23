import {
  waitForEvenAppBridge,
  TextContainerProperty,
  ListContainerProperty,
  ListItemContainerProperty,
  CreateStartUpPageContainer,
  RebuildPageContainer,
  AudioInputSource,
} from '@evenrealities/even_hub_sdk';
import { ActionCard, AlphaDigestItem, GlassesState, GlassesViewMode, VoiceIntentResult } from '../types';
import * as api from './api';

type StateListener = (state: GlassesState) => void;

class LiveGlassesManager {
  private bridge: any = null;
  public isBridgeReady: boolean = false;
  private hasCreatedStartupPage: boolean = false;
  private listeners: Set<StateListener> = new Set();

  private state: GlassesState = {
    currentView: 'AUTH_REQUIRED',
    currentCardIndex: 0,
    cards: [],
    digest: null,
    isRecording: false,
    recordedPcmBytes: 0,
    pendingVoiceResult: null,
    statusMessage: 'Connecting to Telegram & G2...',
    errorMessage: null,
    isTelegramAuthenticated: false,
    isGroqConfigured: false,
  };

  private recordedAudioChunks: Uint8Array[] = [];

  constructor() {}

  public subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  public getState(): GlassesState {
    return { ...this.state };
  }

  private notify() {
    const currentState = this.getState();
    this.listeners.forEach((l) => l(currentState));
  }

  public async init() {
    try {
      console.log('[G2 Manager] Connecting to EvenAppBridge...');
      this.bridge = await waitForEvenAppBridge();
      this.isBridgeReady = true;
      console.log('[G2 Manager] EvenAppBridge connected!');

      // Register Event Listener for glasses gestures
      this.bridge.onEvenHubEvent((event: any) => this.handleEvenHubEvent(event));

      // Check server health & Telegram session state
      await this.refreshData();

      // Render initial Startup Page
      await this.renderCurrentView(true);
    } catch (err: any) {
      console.error('[G2 Manager] Initialization failed:', err);
      this.state.currentView = 'ERROR';
      this.state.errorMessage = err?.message || 'Bridge initialization error';
      this.notify();
    }
  }

  public async refreshData() {
    try {
      const health = await api.fetchHealth();
      this.state.isTelegramAuthenticated = health.telegram?.connected || false;
      this.state.isGroqConfigured = health.groq?.configured || false;

      if (!this.state.isTelegramAuthenticated) {
        this.state.currentView = 'AUTH_REQUIRED';
        this.state.statusMessage = 'Telegram pairing required. Scan QR code on phone.';
        this.notify();
        if (this.hasCreatedStartupPage) await this.renderCurrentView(false);
        return;
      }

      // Fetch live action queue from Telegram VIP chats
      const cards = await api.fetchQueue();
      this.state.cards = cards;

      if (cards.length > 0) {
        this.state.currentView = 'QUEUE';
        this.state.currentCardIndex = 0;
        this.state.statusMessage = `Active · ${cards.length} unread VIP message(s)`;
      } else {
        this.state.currentView = 'EMPTY';
        this.state.statusMessage = 'All caught up · 0 unread VIPs';
      }

      this.state.errorMessage = null;
      this.notify();
      if (this.hasCreatedStartupPage) await this.renderCurrentView(false);
    } catch (err: any) {
      console.error('[G2 Manager] refreshData error:', err);
      this.state.errorMessage = err.message || 'Failed to sync with Telegram';
      if (!this.state.isTelegramAuthenticated) {
        this.state.currentView = 'AUTH_REQUIRED';
      } else {
        this.state.currentView = 'ERROR';
      }
      this.notify();
      if (this.hasCreatedStartupPage) await this.renderCurrentView(false);
    }
  }

  /**
   * Main render method for G2 Display
   */
  public async renderCurrentView(isStartup: boolean = false) {
    if (!this.bridge) {
      console.warn('[G2 Manager] Bridge not ready for render');
      return;
    }

    try {
      switch (this.state.currentView) {
        case 'AUTH_REQUIRED':
          await this.renderAuthRequired(isStartup);
          break;
        case 'EMPTY':
          await this.renderEmptyQueue(isStartup);
          break;
        case 'QUEUE':
          await this.renderQueueCard(isStartup);
          break;
        case 'VOICE_CAPTURE':
          await this.renderVoiceCapture(isStartup);
          break;
        case 'VOICE_CONFIRM':
          await this.renderVoiceConfirm(isStartup);
          break;
        case 'DIGEST':
          await this.renderDigest(isStartup);
          break;
        case 'ERROR':
          await this.renderError(isStartup);
          break;
      }
      this.hasCreatedStartupPage = true;
    } catch (err) {
      console.error('[G2 Manager] Render error:', err);
    }
  }

  /**
   * View: Auth Required
   */
  private async renderAuthRequired(isStartup: boolean) {
    const hdr = new TextContainerProperty({
      xPosition: 0,
      yPosition: 0,
      width: 576,
      height: 34,
      borderWidth: 0,
      borderColor: 12,
      paddingLength: 2,
      containerID: 1,
      containerName: 'auth_hdr',
      isEventCapture: 0,
      content: 'BRIEFTAP · TELEGRAM PAIRING REQUIRED',
    });

    const body = new TextContainerProperty({
      xPosition: 0,
      yPosition: 38,
      width: 576,
      height: 246,
      borderWidth: 1,
      borderColor: 8,
      borderRadius: 4,
      paddingLength: 8,
      containerID: 2,
      containerName: 'auth_body',
      isEventCapture: 1,
      content: 'Telegram MTProto is not paired.\n\nPlease open BriefTap on your phone to scan the Telegram QR code.\n\n[Double Tap] Check connection status',
    });

    if (isStartup && !this.hasCreatedStartupPage) {
      await this.bridge.createStartUpPageContainer(
        new CreateStartUpPageContainer({
          containerTotalNum: 2,
          textObject: [hdr, body],
        })
      );
    } else {
      await this.bridge.rebuildPageContainer(
        new RebuildPageContainer({
          containerTotalNum: 2,
          textObject: [hdr, body],
        })
      );
    }
  }

  /**
   * View: Empty Queue
   */
  private async renderEmptyQueue(isStartup: boolean) {
    const hdr = new TextContainerProperty({
      xPosition: 0,
      yPosition: 0,
      width: 576,
      height: 34,
      borderWidth: 0,
      borderColor: 10,
      paddingLength: 2,
      containerID: 1,
      containerName: 'emp_hdr',
      isEventCapture: 0,
      content: 'BRIEFTAP · ALL CAUGHT UP',
    });

    const body = new TextContainerProperty({
      xPosition: 0,
      yPosition: 38,
      width: 576,
      height: 246,
      borderWidth: 1,
      borderColor: 6,
      borderRadius: 4,
      paddingLength: 8,
      containerID: 2,
      containerName: 'emp_body',
      isEventCapture: 1,
      content: '0 unread VIP messages.\n\n[Single Tap] Open Channel Alpha Digest\n[Double Tap] Refresh Queue from Telegram',
    });

    if (isStartup && !this.hasCreatedStartupPage) {
      await this.bridge.createStartUpPageContainer(
        new CreateStartUpPageContainer({
          containerTotalNum: 2,
          textObject: [hdr, body],
        })
      );
    } else {
      await this.bridge.rebuildPageContainer(
        new RebuildPageContainer({
          containerTotalNum: 2,
          textObject: [hdr, body],
        })
      );
    }
  }

  /**
   * View: Error Screen
   */
  private async renderError(isStartup: boolean) {
    const hdr = new TextContainerProperty({
      xPosition: 0,
      yPosition: 0,
      width: 576,
      height: 34,
      borderWidth: 0,
      borderColor: 14,
      paddingLength: 2,
      containerID: 1,
      containerName: 'err_hdr',
      isEventCapture: 0,
      content: 'BRIEFTAP · ERROR',
    });

    const msg = this.state.errorMessage || 'Unknown error occurred.';
    const body = new TextContainerProperty({
      xPosition: 0,
      yPosition: 38,
      width: 576,
      height: 246,
      borderWidth: 1,
      borderColor: 12,
      borderRadius: 4,
      paddingLength: 8,
      containerID: 2,
      containerName: 'err_body',
      isEventCapture: 1,
      content: `${msg.slice(0, 150)}\n\nCheck phone companion for details.\n[Double Tap] Retry connection`,
    });

    if (isStartup && !this.hasCreatedStartupPage) {
      await this.bridge.createStartUpPageContainer(
        new CreateStartUpPageContainer({
          containerTotalNum: 2,
          textObject: [hdr, body],
        })
      );
    } else {
      await this.bridge.rebuildPageContainer(
        new RebuildPageContainer({
          containerTotalNum: 2,
          textObject: [hdr, body],
        })
      );
    }
  }

  /**
   * View 1: Action Queue Card
   */
  private async renderQueueCard(isStartup: boolean) {
    const total = this.state.cards.length;
    if (total === 0) {
      return this.renderEmptyQueue(isStartup);
    }

    const card = this.state.cards[this.state.currentCardIndex % total];
    const cardIdx = (this.state.currentCardIndex % total) + 1;

    // Header container: 576 x 34
    const headerContainer = new TextContainerProperty({
      xPosition: 0,
      yPosition: 0,
      width: 576,
      height: 34,
      borderWidth: 0,
      borderColor: 8,
      paddingLength: 2,
      containerID: 1,
      containerName: 'hdr',
      isEventCapture: 0,
      content: `FROM: ${card.sender} (${card.chatTitle}) · ${card.timestamp} [${cardIdx}/${total}]`,
    });

    // Summary container: 576 x 72
    const summaryContainer = new TextContainerProperty({
      xPosition: 0,
      yPosition: 36,
      width: 576,
      height: 72,
      borderWidth: 1,
      borderColor: 6,
      borderRadius: 4,
      paddingLength: 6,
      containerID: 2,
      containerName: 'summary',
      isEventCapture: 0,
      content: card.summary,
    });

    // List container: 576 x 174 (3 smart replies + 1 mic action + 1 contextual menu action)
    const listItems = [
      ...card.smartReplies.map((reply) => `> ${reply}`),
      '> [Mic] Speak intent...',
      '> [Menu] Alpha Digest...',
    ];

    const itemProps = new ListItemContainerProperty({
      itemCount: listItems.length,
      itemWidth: 0,
      isItemSelectBorderEn: 1,
      itemName: listItems,
    });

    const repliesListContainer = new ListContainerProperty({
      xPosition: 0,
      yPosition: 112,
      width: 576,
      height: 174,
      borderWidth: 0,
      borderColor: 8,
      paddingLength: 2,
      containerID: 3,
      containerName: 'replies',
      isEventCapture: 1,
      itemContainer: itemProps,
    });

    if (isStartup && !this.hasCreatedStartupPage) {
      await this.bridge.createStartUpPageContainer(
        new CreateStartUpPageContainer({
          containerTotalNum: 3,
          textObject: [headerContainer, summaryContainer],
          listObject: [repliesListContainer],
        })
      );
    } else {
      await this.bridge.rebuildPageContainer(
        new RebuildPageContainer({
          containerTotalNum: 3,
          textObject: [headerContainer, summaryContainer],
          listObject: [repliesListContainer],
        })
      );
    }
  }

  /**
   * View 2: Voice Intent Capture (G2 4-mic array, 16 kHz PCM)
   */
  private async renderVoiceCapture(isStartup: boolean) {
    const hdr = new TextContainerProperty({
      xPosition: 0,
      yPosition: 0,
      width: 576,
      height: 36,
      borderWidth: 0,
      borderColor: 12,
      paddingLength: 2,
      containerID: 1,
      containerName: 'mic_hdr',
      isEventCapture: 0,
      content: 'VOICE INTENT · G2 4-MIC ARRAY',
    });

    const body = new TextContainerProperty({
      xPosition: 0,
      yPosition: 40,
      width: 576,
      height: 244,
      borderWidth: 2,
      borderColor: 14,
      borderRadius: 4,
      paddingLength: 12,
      containerID: 2,
      containerName: 'mic_body',
      isEventCapture: 1,
      content: '● RECORDING (16 kHz PCM)...\n\nSpeak 2-4 words:\n(e.g. "approve push 15 mins")\n\n[Single Tap] Done & Polish with Groq AI\n[Double Tap] Cancel',
    });

    if (isStartup && !this.hasCreatedStartupPage) {
      await this.bridge.createStartUpPageContainer(
        new CreateStartUpPageContainer({
          containerTotalNum: 2,
          textObject: [hdr, body],
        })
      );
    } else {
      await this.bridge.rebuildPageContainer(
        new RebuildPageContainer({
          containerTotalNum: 2,
          textObject: [hdr, body],
        })
      );
    }

    await this.startRecording();
  }

  /**
   * View 3: Voice Reply Confirm
   */
  private async renderVoiceConfirm(isStartup: boolean) {
    const voiceResult = this.state.pendingVoiceResult;
    const card = this.state.cards[this.state.currentCardIndex % (this.state.cards.length || 1)];
    const recipient = card?.sender || 'Telegram Contact';

    const hdr = new TextContainerProperty({
      xPosition: 0,
      yPosition: 0,
      width: 576,
      height: 34,
      borderWidth: 0,
      borderColor: 12,
      paddingLength: 2,
      containerID: 1,
      containerName: 'vc_hdr',
      isEventCapture: 0,
      content: `CONFIRM REPLY TO ${recipient.toUpperCase()}`,
    });

    const preview = new TextContainerProperty({
      xPosition: 0,
      yPosition: 38,
      width: 576,
      height: 144,
      borderWidth: 1,
      borderColor: 10,
      borderRadius: 4,
      paddingLength: 8,
      containerID: 2,
      containerName: 'vc_prev',
      isEventCapture: 0,
      content: `Spoken: "${voiceResult?.transcription || ''}"\n\nAI Polish:\n"${voiceResult?.polishedReply || ''}"`,
    });

    const controls = new TextContainerProperty({
      xPosition: 0,
      yPosition: 188,
      width: 576,
      height: 96,
      borderWidth: 1,
      borderColor: 8,
      borderRadius: 4,
      paddingLength: 8,
      containerID: 3,
      containerName: 'vc_ctrl',
      isEventCapture: 1,
      content: `[Single Tap] Send to ${recipient}\n[Double Tap] Discard & Return`,
    });

    if (isStartup && !this.hasCreatedStartupPage) {
      await this.bridge.createStartUpPageContainer(
        new CreateStartUpPageContainer({
          containerTotalNum: 3,
          textObject: [hdr, preview, controls],
        })
      );
    } else {
      await this.bridge.rebuildPageContainer(
        new RebuildPageContainer({
          containerTotalNum: 3,
          textObject: [hdr, preview, controls],
        })
      );
    }
  }

  /**
   * View 4: Channel Alpha Digest
   */
  private async renderDigest(isStartup: boolean) {
    const digest = this.state.digest;
    const title = digest?.channelTitle || 'TELEGRAM CHANNELS';
    const bulletsText = digest?.bullets?.map((b) => `• ${b}`).join('\n\n') || 'No digest loaded.';

    const hdr = new TextContainerProperty({
      xPosition: 0,
      yPosition: 0,
      width: 576,
      height: 34,
      borderWidth: 0,
      borderColor: 12,
      paddingLength: 2,
      containerID: 1,
      containerName: 'dg_hdr',
      isEventCapture: 0,
      content: `ALPHA DIGEST · ${title.toUpperCase()}`,
    });

    const body = new TextContainerProperty({
      xPosition: 0,
      yPosition: 38,
      width: 576,
      height: 246,
      borderWidth: 1,
      borderColor: 8,
      borderRadius: 4,
      paddingLength: 8,
      containerID: 2,
      containerName: 'dg_body',
      isEventCapture: 1,
      content: `${bulletsText}\n\n[Single Tap] Save to 'Saved Messages'\n[Double Tap] Return to Queue`,
    });

    if (isStartup && !this.hasCreatedStartupPage) {
      await this.bridge.createStartUpPageContainer(
        new CreateStartUpPageContainer({
          containerTotalNum: 2,
          textObject: [hdr, body],
        })
      );
    } else {
      await this.bridge.rebuildPageContainer(
        new RebuildPageContainer({
          containerTotalNum: 2,
          textObject: [hdr, body],
        })
      );
    }
  }

  /**
   * Audio Recording Control (Glasses Mic, 16 kHz PCM)
   */
  private async startRecording() {
    this.recordedAudioChunks = [];
    this.state.isRecording = true;
    this.state.recordedPcmBytes = 0;
    this.state.statusMessage = 'Recording audio from G2 4-mic array...';
    this.notify();

    try {
      if (this.bridge) {
        await this.bridge.audioControl(true, AudioInputSource.Glasses);
        console.log('[G2 Mic] Audio recording active.');
      }
    } catch (err: any) {
      console.error('[G2 Mic] Error opening audio input:', err);
      this.state.errorMessage = err.message || 'Microphone activation error';
      this.state.currentView = 'ERROR';
      this.notify();
      await this.renderCurrentView();
    }
  }

  private async stopRecording(): Promise<Uint8Array> {
    this.state.isRecording = false;
    this.notify();

    try {
      if (this.bridge) {
        await this.bridge.audioControl(false);
        console.log('[G2 Mic] Audio recording stopped.');
      }
    } catch (err) {
      console.warn('[G2 Mic] Error stopping audio input:', err);
    }

    const totalLength = this.recordedAudioChunks.reduce((acc, chunk) => acc + chunk.length, 0);
    const merged = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of this.recordedAudioChunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    return merged;
  }

  /**
   * Central Event Handler for G2 Touchpad Gestures
   */
  private async handleEvenHubEvent(event: any) {
    if (event.audioEvent?.audioPcm) {
      const pcmData = new Uint8Array(event.audioEvent.audioPcm);
      this.recordedAudioChunks.push(pcmData);
      this.state.recordedPcmBytes += pcmData.length;
      this.notify();
      return;
    }

    if (event.listEvent) {
      const selectedIndex = event.listEvent.currentSelectItemIndex ?? 0;
      await this.onListSelect(selectedIndex);
      return;
    }

    if (event.sysEvent) {
      const eventType = event.sysEvent.eventType ?? 0;

      if (eventType === 0) {
        await this.onSingleTap();
      } else if (eventType === 3) {
        await this.onDoubleTap();
      } else if (eventType === 4) {
        await this.renderCurrentView();
      } else if (eventType === 6 || eventType === 7) {
        if (this.state.isRecording) {
          await this.stopRecording();
        }
      }
    }
  }

  private async onListSelect(index: number) {
    if (this.state.currentView !== 'QUEUE') return;

    const total = this.state.cards.length;
    if (total === 0) return;

    const card = this.state.cards[this.state.currentCardIndex % total];
    const numSmartReplies = card.smartReplies.length;

    if (index === numSmartReplies) {
      // "[Mic] Speak intent..." selected
      this.state.currentView = 'VOICE_CAPTURE';
      this.state.statusMessage = 'Voice Intent · Listening on G2 4-mic array...';
      this.notify();
      await this.renderCurrentView();
      return;
    }

    if (index === numSmartReplies + 1) {
      // "[Menu] Alpha Digest..." selected via contextual menu
      this.state.statusMessage = 'Opening Channel Alpha Digest...';
      this.notify();
      await this.loadDigestView();
      return;
    }

    // 1-Tap Write: Send reply to Telegram
    const replyText = card.smartReplies[index];
    if (!replyText) return;

    try {
      this.state.statusMessage = `Sending live reply: "${replyText}"...`;
      this.notify();

      await api.sendReply(card.chatId, replyText, card.replyToMsgId);

      // Remove card from queue
      this.state.cards = this.state.cards.filter((c) => c.id !== card.id);
      if (this.state.cards.length === 0) {
        this.state.currentView = 'EMPTY';
        this.state.statusMessage = 'All caught up · 0 unread VIPs';
      } else {
        this.state.currentCardIndex = this.state.currentCardIndex % this.state.cards.length;
        this.state.statusMessage = `Active · ${this.state.cards.length} unread VIP message(s)`;
      }
      this.notify();
      await this.renderCurrentView();
    } catch (err: any) {
      console.error('[G2 Action] Failed to send reply:', err);
      this.state.errorMessage = err.message || 'Failed to send Telegram reply';
      this.state.currentView = 'ERROR';
      this.notify();
      await this.renderCurrentView();
    }
  }

  public async onSingleTap() {
    switch (this.state.currentView) {
      case 'EMPTY':
        // Open Alpha Digest
        await this.loadDigestView();
        break;

      case 'VOICE_CAPTURE': {
        // Stop recording and process live via Groq Whisper + Llama 3.1
        try {
          this.state.statusMessage = 'Transcribing & Polishing via Groq AI...';
          this.notify();

          const pcmBuffer = await this.stopRecording();
          if (pcmBuffer.length === 0) {
            throw new Error('No audio recorded from G2 mic.');
          }

          const base64Audio = this.bufferToBase64(pcmBuffer);
          const card = this.state.cards[this.state.currentCardIndex % (this.state.cards.length || 1)];

          const voiceResult = await api.sendVoiceIntent(
            base64Audio,
            true,
            card?.summary || card?.rawText,
            card?.sender
          );

          this.state.pendingVoiceResult = voiceResult;
          this.state.currentView = 'VOICE_CONFIRM';
          this.state.statusMessage = `AI Polish: "${voiceResult.polishedReply}"`;
          this.notify();
          await this.renderCurrentView();
        } catch (err: any) {
          console.error('[G2 Voice Error]', err);
          this.state.errorMessage = err.message || 'Voice intent processing failed on Groq API';
          this.state.currentView = 'ERROR';
          this.notify();
          await this.renderCurrentView();
        }
        break;
      }

      case 'VOICE_CONFIRM': {
        // Send confirmed polished reply to Telegram
        try {
          const voiceResult = this.state.pendingVoiceResult;
          const card = this.state.cards[this.state.currentCardIndex % (this.state.cards.length || 1)];
          if (voiceResult && card) {
            this.state.statusMessage = `Sending live reply: "${voiceResult.polishedReply}"...`;
            this.notify();

            await api.sendReply(card.chatId, voiceResult.polishedReply, card.replyToMsgId);
            this.state.cards = this.state.cards.filter((c) => c.id !== card.id);
          }
          this.state.pendingVoiceResult = null;
          this.state.currentView = this.state.cards.length > 0 ? 'QUEUE' : 'EMPTY';
          this.notify();
          await this.renderCurrentView();
        } catch (err: any) {
          this.state.errorMessage = err.message || 'Failed to send reply to Telegram';
          this.state.currentView = 'ERROR';
          this.notify();
          await this.renderCurrentView();
        }
        break;
      }

      case 'DIGEST': {
        // Save digest bullet to Telegram Saved Messages
        if (this.state.digest && this.state.digest.bullets.length > 0) {
          try {
            const bullet = this.state.digest.bullets[0];
            await api.saveDigest(bullet);
            this.state.statusMessage = 'Saved to Telegram "Saved Messages" ✓';
            this.notify();
          } catch (err: any) {
            this.state.errorMessage = err.message || 'Failed to save digest';
            this.state.currentView = 'ERROR';
            this.notify();
            await this.renderCurrentView();
          }
        }
        break;
      }
    }
  }

  public async onDoubleTap() {
    switch (this.state.currentView) {
      case 'AUTH_REQUIRED':
      case 'ERROR':
        // Re-check Telegram session & health
        await this.refreshData();
        break;

      case 'EMPTY':
        // Re-check unread VIPs from Telegram
        await this.refreshData();
        break;

      case 'QUEUE': {
        // Skip current card
        const total = this.state.cards.length;
        if (total > 0) {
          this.state.currentCardIndex = (this.state.currentCardIndex + 1) % total;
          this.notify();
          await this.renderCurrentView();
        }
        break;
      }

      case 'VOICE_CAPTURE':
        await this.stopRecording();
        this.state.currentView = this.state.cards.length > 0 ? 'QUEUE' : 'EMPTY';
        this.notify();
        await this.renderCurrentView();
        break;

      case 'VOICE_CONFIRM':
        this.state.pendingVoiceResult = null;
        this.state.currentView = this.state.cards.length > 0 ? 'QUEUE' : 'EMPTY';
        this.notify();
        await this.renderCurrentView();
        break;

      case 'DIGEST':
        this.state.currentView = this.state.cards.length > 0 ? 'QUEUE' : 'EMPTY';
        this.state.statusMessage = this.state.cards.length > 0
          ? `Action Queue · ${this.state.cards.length} unread VIP message(s)`
          : 'All caught up · 0 unread VIPs';
        this.notify();
        await this.renderCurrentView();
        break;
    }
  }

  public async loadDigestView() {
    try {
      this.state.statusMessage = 'Fetching Channel Alpha Digest from Telegram...';
      this.notify();
      const digest = await api.fetchDigest();
      this.state.digest = digest;
      this.state.currentView = 'DIGEST';
      this.state.statusMessage = `Alpha Digest · ${digest.channelTitle} (${digest.bullets?.length || 0} bullets)`;
      this.notify();
      await this.renderCurrentView();
    } catch (err: any) {
      this.state.errorMessage = err.message || 'Failed to load channel digest';
      this.state.currentView = 'ERROR';
      this.state.statusMessage = 'Error loading Alpha Digest';
      this.notify();
      await this.renderCurrentView();
    }
  }

  public async setView(view: GlassesViewMode) {
    if (view === 'DIGEST' && !this.state.digest) {
      await this.loadDigestView();
      return;
    }
    this.state.currentView = view;
    if (view === 'QUEUE') {
      this.state.statusMessage = this.state.cards.length > 0
        ? `Action Queue · ${this.state.cards.length} unread VIP message(s)`
        : 'All caught up · 0 unread VIPs';
    } else if (view === 'DIGEST') {
      this.state.statusMessage = `Alpha Digest · ${this.state.digest?.channelTitle || 'Channels'}`;
    }
    this.notify();
    await this.renderCurrentView();
  }

  public triggerListItem(index: number) {
    return this.onListSelect(index);
  }

  private bufferToBase64(bytes: Uint8Array): string {
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }
}

export const glassesManager = new LiveGlassesManager();
