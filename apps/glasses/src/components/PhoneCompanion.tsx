import React, { useState, useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import { GlassesState, TelegramDialog } from '../types';
import { glassesManager } from '../services/glassesManager';
import { GlassesVirtualPreview } from './GlassesVirtualPreview';
import * as api from '../services/api';
import {
  MessageSquare,
  Mic,
  Send,
  RefreshCw,
  Radio,
  CheckCircle2,
  AlertTriangle,
  QrCode,
  Phone,
  ShieldCheck,
  Layers,
  ChevronRight,
  ExternalLink,
  Copy,
} from 'lucide-react';

interface Props {
  state: GlassesState;
}

export const PhoneCompanion: React.FC<Props> = ({ state }) => {
  const [health, setHealth] = useState<any>(null);
  const [chats, setChats] = useState<TelegramDialog[]>([]);
  const [selectedVipIds, setSelectedVipIds] = useState<string[]>([]);
  const [selectedDigestIds, setSelectedDigestIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // QR Auth state
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrRawUrl, setQrRawUrl] = useState<string | null>(null);
  const [isQrLoading, setIsQrLoading] = useState(false);
  const [qrError, setQrError] = useState<string | null>(null);
  const [qrCountdown, setQrCountdown] = useState<number>(25);
  const [copiedLink, setCopiedLink] = useState(false);
  const qrRawUrlRef = useRef<string | null>(null);
  qrRawUrlRef.current = qrRawUrl;

  // Phone Auth state
  const [phoneNumber, setPhoneNumber] = useState('');
  const [phoneCode, setPhoneCode] = useState('');
  const [password, setPassword] = useState('');
  const [phoneCodeHash, setPhoneCodeHash] = useState<string | null>(null);
  const [phoneStep, setPhoneStep] = useState<'phone' | 'code'>('phone');

  // Active view tab: 'chats' | 'digest' | 'auth'
  const [activeTab, setActiveTab] = useState<'vip' | 'digest' | 'auth'>('vip');

  const consecutiveFailuresRef = useRef<number>(0);
  const isFetchingRef = useRef<boolean>(false);

  const checkHealthAndLoad = async () => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;
    try {
      const h = await api.fetchHealth();
      setHealth(h);

      if (h.telegram?.connected) {
        try {
          const [dialogs, config] = await Promise.all([api.fetchChats(), api.fetchVipConfig()]);
          setChats(dialogs);
          setSelectedVipIds(config.vipChatIds || []);
          setSelectedDigestIds(config.digestChannelIds || []);
          setErrorMessage(null);
          consecutiveFailuresRef.current = 0;
        } catch (chatErr: any) {
          console.warn('[PhoneCompanion] Error loading chats:', chatErr.message);
          consecutiveFailuresRef.current += 1;
        }
      } else {
        // When not connected, never poll or keep stale chats
        setChats([]);
        setErrorMessage(null);
        consecutiveFailuresRef.current = 0;
      }
    } catch (err: any) {
      console.warn('[PhoneCompanion] Health check error:', err.message);
      consecutiveFailuresRef.current += 1;
    } finally {
      isFetchingRef.current = false;
    }
  };

  useEffect(() => {
    let timeoutId: any;
    let isMounted = true;

    const runPollLoop = async () => {
      await checkHealthAndLoad();
      if (!isMounted) return;

      // Backoff on consecutive failures: 4s default, scaling up to 20s
      const delay = consecutiveFailuresRef.current > 0
        ? Math.min(4000 * Math.pow(1.5, consecutiveFailuresRef.current), 20000)
        : 4000;

      timeoutId = setTimeout(runPollLoop, delay);
    };

    runPollLoop();

    return () => {
      isMounted = false;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, []);

  // Polling for QR approval and token countdown
  useEffect(() => {
    if (!qrRawUrl || health?.telegram?.connected) return;

    // Poll status every 2.5 seconds
    const statusInterval = setInterval(async () => {
      try {
        const status = await api.getQrAuthStatus();
        if (status.status === 'authenticated') {
          setQrRawUrl(null);
          setQrDataUrl(null);
          setQrError(null);
          await checkHealthAndLoad();
          await glassesManager.refreshData();
        } else if (status.qrUrl && status.qrUrl !== qrRawUrlRef.current) {
          setQrRawUrl(status.qrUrl);
          const dataUrl = await QRCode.toDataURL(status.qrUrl, { margin: 2, scale: 6 });
          setQrDataUrl(dataUrl);
          setQrCountdown(25);
          setQrError(null);
        } else if (status.error) {
          setQrError(status.error);
        }
      } catch (e: any) {
        // network polling error handled gracefully
      }
    }, 2500);

    // Countdown ticker (Telegram QR tokens expire every 30s)
    const countdownTimer = setInterval(() => {
      setQrCountdown((prev) => {
        if (prev <= 1) {
          handleStartQr(true); // silent refresh
          return 25;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      clearInterval(statusInterval);
      clearInterval(countdownTimer);
    };
  }, [qrRawUrl, health?.telegram?.connected]);

  const handleStartQr = async (isSilent = false) => {
    if (!isSilent) {
      setIsQrLoading(true);
      setQrError(null);
    }
    try {
      const auth = await api.startQrAuth();
      if (auth.error) {
        setQrError(auth.error);
        return;
      }
      if (auth.status === 'authenticated') {
        setQrRawUrl(null);
        setQrDataUrl(null);
        await checkHealthAndLoad();
        await glassesManager.refreshData();
        return;
      }

      let activeUrl = auth.qrUrl;
      if (!activeUrl) {
        // Quick fallback poll in case token arrived on next tick
        const status = await api.getQrAuthStatus();
        if (status.qrUrl) activeUrl = status.qrUrl;
      }

      if (activeUrl) {
        setQrRawUrl(activeUrl);
        const dataUrl = await QRCode.toDataURL(activeUrl, { margin: 2, scale: 6 });
        setQrDataUrl(dataUrl);
        setQrCountdown(25);
        setQrError(null);
      } else {
        setQrError('Could not obtain Telegram QR token from MTProto. Click Retry to request a fresh token.');
      }
    } catch (err: any) {
      setQrError(err.message || 'Failed to start Telegram QR pairing');
    } finally {
      if (!isSilent) {
        setIsQrLoading(false);
      }
    }
  };

  const handleSendPhoneCode = async () => {
    if (!phoneNumber) return;
    setLoading(true);
    setErrorMessage(null);
    try {
      const res = await api.sendPhoneCode(phoneNumber);
      setPhoneCodeHash(res.phoneCodeHash);
      setPhoneStep('code');
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to send phone confirmation code');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyPhoneCode = async () => {
    if (!phoneNumber || !phoneCodeHash || !phoneCode) return;
    setLoading(true);
    setErrorMessage(null);
    try {
      await api.verifyPhoneCode({
        phoneNumber,
        phoneCodeHash,
        phoneCode,
        password: password || undefined,
      });
      await checkHealthAndLoad();
      await glassesManager.refreshData();
    } catch (err: any) {
      setErrorMessage(err.message || 'Phone verification failed');
    } finally {
      setLoading(false);
    }
  };

  const toggleVipChat = async (chatId: string) => {
    let next: string[];
    if (selectedVipIds.includes(chatId)) {
      next = selectedVipIds.filter((id) => id !== chatId);
    } else {
      if (selectedVipIds.length >= 5) {
        alert('You can select a maximum of 5 VIP chats for the G2 glasses display.');
        return;
      }
      next = [...selectedVipIds, chatId];
    }
    setSelectedVipIds(next);
    await api.saveVipConfig(next, selectedDigestIds);
    await glassesManager.refreshData();
  };

  const toggleDigestChannel = async (channelId: string) => {
    let next: string[];
    if (selectedDigestIds.includes(channelId)) {
      next = selectedDigestIds.filter((id) => id !== channelId);
    } else {
      if (selectedDigestIds.length >= 5) {
        alert('You can select a maximum of 5 Digest channels for the G2 glasses display.');
        return;
      }
      next = [...selectedDigestIds, channelId];
    }
    setSelectedDigestIds(next);
    await api.saveVipConfig(selectedVipIds, next);
  };

  const isTgConnected = Boolean(health?.telegram?.connected);
  const isGroqConfigured = Boolean(health?.groq?.configured);

  return (
    <div className="phone-container">
      {/* Header */}
      <header className="companion-header">
        <div className="brand-block">
          <div className="brand-icon">
            <Radio className="icon-pulse" size={22} />
          </div>
          <div>
            <h1 className="brand-title">BriefTap</h1>
            <p className="brand-subtitle">Even Realities G2 · Track 01 Telegram (100% Live MTProto)</p>
          </div>
        </div>

        <div className="status-pills">
          <span className={`status-pill ${glassesManager.isBridgeReady ? 'status-g2' : 'status-warn'}`}>
            <CheckCircle2 size={13} /> {glassesManager.isBridgeReady ? 'G2 Bridge Ready' : 'Connecting Bridge...'}
          </span>
          <span className={`status-pill ${isTgConnected ? 'status-live' : 'status-danger'}`}>
            {isTgConnected ? `Telegram: @${health?.telegram?.user?.username || 'Connected'}` : 'Telegram: Disconnected'}
          </span>
          <span className={`status-pill ${isGroqConfigured ? 'status-live' : 'status-warn'}`}>
            {isGroqConfigured ? 'Groq AI: Live' : 'Groq API Key Missing'}
          </span>
        </div>
      </header>

      {/* Error Banner */}
      {errorMessage && (
        <div className="error-banner">
          <AlertTriangle size={18} />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Grid Layout */}
      <main className="companion-grid">
        {/* Left Column: Telegram Pairing & Dialog Selectors */}
        <section className="column-config">
          {/* Navigation Tabs */}
          <div className="tabs-bar">
            <button
              className={`tab-btn ${activeTab === 'vip' ? 'active' : ''}`}
              onClick={() => setActiveTab('vip')}
            >
              <MessageSquare size={14} /> VIP Chats ({selectedVipIds.length}/5)
            </button>
            <button
              className={`tab-btn ${activeTab === 'digest' ? 'active' : ''}`}
              onClick={() => setActiveTab('digest')}
            >
              <Layers size={14} /> Channels ({selectedDigestIds.length}/5)
            </button>
            <button
              className={`tab-btn ${activeTab === 'auth' ? 'active' : ''}`}
              onClick={() => setActiveTab('auth')}
            >
              <ShieldCheck size={14} /> Telegram Auth
            </button>
          </div>

          {/* TAB 1: VIP CHATS */}
          {activeTab === 'vip' && (
            <div className="card-box">
              <div className="card-header">
                <div className="card-title">
                  <MessageSquare size={18} className="text-accent" />
                  <span>Select VIP Priority Chats (Max 5)</span>
                </div>
                <button
                  className="btn-refresh"
                  onClick={() => checkHealthAndLoad()}
                  disabled={loading}
                >
                  <RefreshCw size={13} /> Refresh
                </button>
              </div>

              {!isTgConnected ? (
                <div className="auth-prompt-box">
                  <AlertTriangle size={24} className="text-warn" />
                  <p>Telegram is not paired yet. Please link your Telegram account to load your real dialogs.</p>
                  <button className="btn-action-primary" onClick={() => setActiveTab('auth')}>
                    Go to Telegram Auth &rarr;
                  </button>
                </div>
              ) : (
                <div className="vip-chat-list">
                  {chats.length === 0 ? (
                    <div className="empty-msg">No chats loaded. Check your Telegram account.</div>
                  ) : (
                    chats.map((chat) => {
                      const isVip = selectedVipIds.includes(chat.id);
                      return (
                        <div
                          key={chat.id}
                          className={`vip-chat-item ${isVip ? 'active' : ''}`}
                          onClick={() => toggleVipChat(chat.id)}
                        >
                          <div className="vip-chat-info">
                            <span className="vip-chat-title">{chat.title}</span>
                            <span className="vip-chat-type">
                              {chat.type.toUpperCase()} · {chat.unreadCount} unread
                            </span>
                          </div>
                          <button className={`btn-pill-toggle ${isVip ? 'on' : 'off'}`}>
                            {isVip ? 'VIP Active' : 'Muted'}
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: DIGEST CHANNELS */}
          {activeTab === 'digest' && (
            <div className="card-box">
              <div className="card-header">
                <div className="card-title">
                  <Layers size={18} className="text-accent" />
                  <span>Select Channel Alpha Digest Sources (Max 5)</span>
                </div>
              </div>

              {!isTgConnected ? (
                <div className="auth-prompt-box">
                  <p>Please pair Telegram first.</p>
                </div>
              ) : (
                <div className="vip-chat-list">
                  {chats
                    .filter((c) => c.type === 'channel' || c.type === 'group')
                    .map((chat) => {
                      const isSelected = selectedDigestIds.includes(chat.id);
                      return (
                        <div
                          key={chat.id}
                          className={`vip-chat-item ${isSelected ? 'active' : ''}`}
                          onClick={() => toggleDigestChannel(chat.id)}
                        >
                          <div className="vip-chat-info">
                            <span className="vip-chat-title">{chat.title}</span>
                            <span className="vip-chat-type">{chat.type.toUpperCase()}</span>
                          </div>
                          <button className={`btn-pill-toggle ${isSelected ? 'on' : 'off'}`}>
                            {isSelected ? 'Digest Source' : 'Exclude'}
                          </button>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: TELEGRAM AUTH */}
          {activeTab === 'auth' && (
            <div className="card-box">
              <div className="card-header">
                <div className="card-title">
                  <QrCode size={18} className="text-accent" />
                  <span>Telegram MTProto Authentication</span>
                </div>
              </div>

              {isTgConnected ? (
                <div className="auth-connected-box">
                  <CheckCircle2 size={32} className="text-success" />
                  <h3>Telegram Connected</h3>
                  <p>Account: <strong>@{health?.telegram?.user?.username || health?.telegram?.user?.firstName}</strong></p>
                  <p className="dim-text">Your StringSession is safely stored in <code>session.txt</code> on the server.</p>
                </div>
              ) : (
                <div className="auth-flows">
                  {/* Method 1: QR Code Login */}
                  <div className="auth-section">
                    <h4>Method 1: Scan QR Code (Fastest)</h4>
                    <p className="subtext">Open Telegram on your phone &gt; Settings &gt; Devices &gt; Link Desktop Device</p>

                    {isQrLoading && (
                      <div className="qr-loading-box">
                        <RefreshCw className="icon-spin" size={16} />
                        <span>Requesting live Telegram MTProto QR token...</span>
                      </div>
                    )}

                    {qrError && (
                      <div className="qr-error-box">
                        <AlertTriangle size={16} />
                        <span className="qr-error-msg">{qrError}</span>
                        <button className="btn-retry-mini" onClick={() => handleStartQr(false)}>Retry</button>
                      </div>
                    )}

                    {qrDataUrl && !isQrLoading ? (
                      <div className="qr-container">
                        <div className="qr-wrapper">
                          <img src={qrDataUrl} alt="Telegram QR Login" className="qr-image" />
                          <div className="qr-timer-pill">
                            <span className="dot-pulse"></span>
                            Token active · Refreshes in {qrCountdown}s
                          </div>
                        </div>

                        <div className="qr-actions-row">
                          {qrRawUrl && (
                            <a href={qrRawUrl} target="_blank" rel="noreferrer" className="btn-action-primary qr-open-btn">
                              Open in Telegram <ExternalLink size={13} />
                            </a>
                          )}
                          {qrRawUrl && (
                            <button
                              className="btn-action-secondary"
                              onClick={() => {
                                navigator.clipboard.writeText(qrRawUrl);
                                setCopiedLink(true);
                                setTimeout(() => setCopiedLink(false), 2000);
                              }}
                            >
                              <Copy size={13} /> {copiedLink ? 'Copied!' : 'Copy tg:// Link'}
                            </button>
                          )}
                          <button
                            className="btn-refresh"
                            onClick={() => handleStartQr(false)}
                            disabled={isQrLoading}
                          >
                            <RefreshCw size={12} /> Refresh QR
                          </button>
                        </div>

                        <span className="qr-waiting-text">
                          Waiting for approval on your Telegram app... Point camera or open link.
                        </span>
                      </div>
                    ) : (
                      !isQrLoading && (
                        <button
                          className="btn-action-primary"
                          onClick={() => handleStartQr(false)}
                          disabled={isQrLoading}
                        >
                          <QrCode size={16} /> Generate Login QR Code
                        </button>
                      )
                    )}
                  </div>

                  {/* Method 2: Phone Login */}
                  <div className="auth-section">
                    <h4>Method 2: Phone Number + SMS Code</h4>
                    {phoneStep === 'phone' ? (
                      <div className="phone-input-row">
                        <input
                          type="text"
                          placeholder="+1234567890"
                          value={phoneNumber}
                          onChange={(e) => setPhoneNumber(e.target.value)}
                          className="input-field"
                        />
                        <button
                          className="btn-action-secondary"
                          onClick={handleSendPhoneCode}
                          disabled={loading || !phoneNumber}
                        >
                          Send Code
                        </button>
                      </div>
                    ) : (
                      <div className="phone-code-form">
                        <input
                          type="text"
                          placeholder="Telegram SMS Code"
                          value={phoneCode}
                          onChange={(e) => setPhoneCode(e.target.value)}
                          className="input-field"
                        />
                        <input
                          type="password"
                          placeholder="2FA Password (if enabled)"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          className="input-field"
                        />
                        <button
                          className="btn-action-primary"
                          onClick={handleVerifyPhoneCode}
                          disabled={loading || !phoneCode}
                        >
                          Verify &amp; Connect
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Active Queue Summary */}
          <div className="card-box">
            <div className="card-header">
              <div className="card-title">
                <Send size={18} className="text-accent" />
                <span>Live Glasses Queue ({state.cards.length} Actionable)</span>
              </div>
              <button
                className="btn-refresh"
                onClick={() => glassesManager.refreshData()}
                disabled={loading}
              >
                <RefreshCw size={13} /> Check Telegram
              </button>
            </div>

            <div className="queue-list-preview">
              {state.cards.length === 0 ? (
                <div className="empty-queue-msg">
                  {isTgConnected
                    ? 'All caught up! No unread messages in your VIP chats.'
                    : 'Pair Telegram to start receiving VIP messages.'}
                </div>
              ) : (
                state.cards.map((card, idx) => (
                  <div
                    key={card.id}
                    className={`queue-card-preview ${idx === state.currentCardIndex ? 'active-card' : ''}`}
                  >
                    <div className="queue-preview-hdr">
                      <strong>{card.sender}</strong> ({card.chatTitle}) · {card.timestamp}
                    </div>
                    <div className="queue-preview-summary">{card.summary}</div>
                    <div className="queue-preview-replies">
                      {card.smartReplies.map((r, i) => (
                        <span key={i} className="mini-reply-chip">
                          {r}
                        </span>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>

        {/* Right Column: Live G2 Glasses HUD Display Framebuffer */}
        <section className="column-display">
          <div className="display-card-box">
            <div className="card-header">
              <div className="card-title">
                <Mic size={18} className="text-accent" />
                <span>G2 Display Live View (576×288)</span>
              </div>
              <span className="status-tag">Status: {state.statusMessage}</span>
            </div>

            {/* Virtual HUD Framebuffer Preview */}
            <GlassesVirtualPreview state={state} />

            <div className="g2-instructions-box">
              <h3>Even Realities G2 Touchpad Gestures</h3>
              <ul>
                <li><strong>Swipe Up / Down:</strong> Move selection through smart replies natively on G2</li>
                <li><strong>Single Tap:</strong> 1-Tap Write (send real selected reply to Telegram &amp; mark as read)</li>
                <li><strong>Select [Mic]:</strong> Real 16kHz audio capture from G2 4-mic array &rarr; Whisper &rarr; Llama 3.1</li>
                <li><strong>Double Tap:</strong> Dismiss/skip card or return to Action Queue</li>
              </ul>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
};
