import React from 'react';
import { GlassesState } from '../types';
import { glassesManager } from '../services/glassesManager';

interface Props {
  state: GlassesState;
}

export const GlassesVirtualPreview: React.FC<Props> = ({ state }) => {
  const currentCard = state.cards[state.currentCardIndex % (state.cards.length || 1)];
  const totalCards = state.cards.length;

  return (
    <div className="virtual-hud-container">
      <div className="hud-badge-bar">
        <span className="hud-label">G2 HUD FRAMEBUFFER (576 × 288 px · 4-bit Green)</span>
        <span className="hud-view-tag">{state.currentView}</span>
      </div>

      <div className="virtual-hud-frame">
        {state.currentView === 'AUTH_REQUIRED' && (
          <div className="hud-screen hud-auth">
            <div className="hud-header">BRIEFTAP · TELEGRAM PAIRING REQUIRED</div>
            <div className="hud-empty-content">
              Telegram MTProto is not paired.<br /><br />
              Please open BriefTap companion on your phone to scan the QR code or login with your phone number.<br /><br />
              [Double Tap] Check connection status
            </div>
          </div>
        )}

        {state.currentView === 'EMPTY' && (
          <div className="hud-screen hud-empty">
            <div className="hud-header">BRIEFTAP · ALL CAUGHT UP</div>
            <div className="hud-empty-content">
              0 unread VIP messages.<br /><br />
              [Single Tap] Open Channel Alpha Digest<br />
              [Double Tap] Refresh Queue from Telegram
            </div>
          </div>
        )}

        {state.currentView === 'ERROR' && (
          <div className="hud-screen hud-error">
            <div className="hud-header">BRIEFTAP · ERROR</div>
            <div className="hud-empty-content" style={{ color: '#FF5252' }}>
              {state.errorMessage || 'Unknown error occurred.'}<br /><br />
              Check phone companion for details.<br />
              [Double Tap] Retry connection
            </div>
          </div>
        )}

        {state.currentView === 'QUEUE' && (
          <div className="hud-screen hud-queue">
            {totalCards > 0 && currentCard && (
              <>
                <div className="hud-header">
                  FROM: {currentCard.sender} ({currentCard.chatTitle}) · {currentCard.timestamp} [{state.currentCardIndex + 1}/{totalCards}]
                </div>
                <div className="hud-summary-box">
                  {currentCard.summary}
                </div>
                <div className="hud-list-box">
                  {currentCard.smartReplies.map((reply, idx) => (
                    <div
                      key={idx}
                      className="hud-list-item"
                      onClick={() => glassesManager.triggerListItem(idx)}
                      title="Click to simulate tap on this item"
                    >
                      &gt; {reply}
                    </div>
                  ))}
                  <div
                    className="hud-list-item hud-mic-item"
                    onClick={() => glassesManager.triggerListItem(3)}
                    title="Click to simulate tap on Mic intent"
                  >
                    &gt; [Mic] Speak intent...
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {state.currentView === 'VOICE_CAPTURE' && (
          <div className="hud-screen hud-voice-capture">
            <div className="hud-header">VOICE INTENT · G2 4-MIC ARRAY</div>
            <div className="hud-voice-box">
              <div className="recording-indicator">
                <span className="blink-dot">●</span> RECORDING (16 kHz PCM)...
              </div>
              <div className="hud-subtext">
                Captured: {state.recordedPcmBytes} bytes<br />
                Speak 2-4 words (e.g. &quot;approve push 15 mins&quot;)
              </div>
              <div className="hud-actions-hint">
                [Single Tap] Done &amp; Polish with Groq AI<br />
                [Double Tap] Cancel
              </div>
            </div>
          </div>
        )}

        {state.currentView === 'VOICE_CONFIRM' && (
          <div className="hud-screen hud-voice-confirm">
            <div className="hud-header">
              CONFIRM REPLY TO {currentCard?.sender?.toUpperCase() || 'TELEGRAM'}
            </div>
            <div className="hud-preview-box">
              <div className="spoken-row">
                Spoken: &quot;{state.pendingVoiceResult?.transcription || ''}&quot;
              </div>
              <div className="ai-polish-row">
                AI Polish:<br />
                &quot;{state.pendingVoiceResult?.polishedReply || ''}&quot;
              </div>
            </div>
            <div className="hud-controls-box">
              [Single Tap] Send to {currentCard?.sender || 'Recipient'}<br />
              [Double Tap] Discard &amp; Return
            </div>
          </div>
        )}

        {state.currentView === 'DIGEST' && (
          <div className="hud-screen hud-digest">
            <div className="hud-header">
              ALPHA DIGEST · {state.digest?.channelTitle?.toUpperCase() || 'CHANNELS'}
            </div>
            <div className="hud-digest-box">
              {state.digest?.bullets.map((bullet, idx) => (
                <div key={idx} className="digest-bullet">
                  • {bullet}
                </div>
              ))}
              <div className="digest-footer-hint">
                [Single Tap] Save to &apos;Saved Messages&apos;<br />
                [Double Tap] Return to Action Queue
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Quick Interactive Control Bar */}
      <div className="hud-touchpad-sim">
        <span className="sim-label">Hardware Touchpad Simulator:</span>
        <button
          className="btn-touchpad"
          onClick={() => glassesManager.onSingleTap()}
          title="Fires sysEvent CLICK_EVENT (eventType: 0)"
        >
          Single Tap
        </button>
        <button
          className="btn-touchpad"
          onClick={() => glassesManager.onDoubleTap()}
          title="Fires sysEvent DOUBLE_CLICK_EVENT (eventType: 3)"
        >
          Double Tap (Skip / Back / Refresh)
        </button>
      </div>
    </div>
  );
};
