/**
 * Adaptive vocabulary-recognition proficiency assessment.
 *
 * Round 1: mid zone (300–700). Score ≥4/6 → go high; else go low.
 * Round 2: high (700–1200) or low (50–300). Score determines level.
 * Optional Round 3: only when Round 2 score is borderline (exactly 3/6).
 *
 * Level boundaries mirror the word-generation skip positions:
 *   newbie=0, a1=200, a2=500, b1=1000
 */

import { LitElement, html, css } from 'lit';
import { customElement, state, property } from 'lit/decorators.js';
import { sharedStyles } from '../styles/shared.js';

export type ProficiencyLevel = 'newbie' | 'a1' | 'a2' | 'b1';

interface AssessmentWord {
  word: string;
  translation: string;
}

type Zone = 'mid' | 'high' | 'low' | 'high2' | 'low2';

interface ZoneConfig {
  minPos: number;
  maxPos: number;
}

const ZONES: Record<Zone, ZoneConfig> = {
  mid: { minPos: 300, maxPos: 700 },
  high: { minPos: 700, maxPos: 1200 },
  low: { minPos: 50, maxPos: 300 },
  high2: { minPos: 1000, maxPos: 1500 }, // tiebreak for borderline high
  low2: { minPos: 150, maxPos: 450 }, // tiebreak for borderline low
};

@customElement('language-assessment')
export class LanguageAssessment extends LitElement {
  @property({ type: String })
  language = '';

  @state() private words: AssessmentWord[] = [];
  @state() private knownWords = new Set<string>();
  @state() private hoveredWord: string | null = null;
  @state() private loading = true;

  // Adaptive state
  private currentZone: Zone = 'mid';
  private roundScores: { zone: Zone; known: number; total: number }[] = [];

  static styles = [
    sharedStyles,
    css`
      :host {
        display: block;
      }

      .modal-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
      }

      .modal-content {
        background: white;
        padding: 2rem;
        border-radius: 12px;
        max-width: 520px;
        width: 90%;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
      }

      .modal-title {
        font-size: 22px;
        font-weight: 600;
        color: var(--text-primary);
        margin: 0 0 var(--spacing-sm) 0;
        text-align: center;
      }

      .modal-subtitle {
        font-size: 14px;
        color: var(--text-secondary);
        margin: 0 0 var(--spacing-xl) 0;
        text-align: center;
      }

      .progress-dots {
        display: flex;
        justify-content: center;
        gap: 6px;
        margin-bottom: var(--spacing-xl);
      }

      .dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--border-color);
        transition: background 0.2s ease;
      }

      .dot.active {
        background: var(--primary-color);
      }

      .dot.done {
        background: var(--success-color);
      }

      .word-grid {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        justify-content: center;
        margin-bottom: var(--spacing-xl);
        min-height: 100px;
      }

      .word-chip {
        position: relative;
        padding: 8px 18px;
        border-radius: 20px;
        font-size: 16px;
        font-weight: 500;
        cursor: pointer;
        user-select: none;
        border: 2px solid transparent;
        background: var(--background-secondary);
        color: var(--text-primary);
        transition:
          background 0.15s ease,
          color 0.15s ease,
          border-color 0.15s ease,
          transform 0.1s ease;
        -webkit-app-region: no-drag;
      }

      .word-chip:hover {
        border-color: var(--primary-color);
        transform: translateY(-1px);
      }

      .word-chip.known {
        background: var(--primary-color);
        color: white;
        border-color: var(--primary-color);
      }

      .word-chip.known:hover {
        background: var(--primary-hover);
        border-color: var(--primary-hover);
      }

      .translation-tooltip {
        position: absolute;
        bottom: calc(100% + 6px);
        left: 50%;
        transform: translateX(-50%);
        background: #333;
        color: white;
        font-size: 12px;
        font-weight: 400;
        padding: 4px 10px;
        border-radius: 6px;
        white-space: nowrap;
        pointer-events: none;
        z-index: 1;
      }

      .translation-tooltip::after {
        content: '';
        position: absolute;
        top: 100%;
        left: 50%;
        transform: translateX(-50%);
        border: 5px solid transparent;
        border-top-color: #333;
      }

      .loading {
        text-align: center;
        color: var(--text-secondary);
        padding: var(--spacing-xl) 0;
        font-size: 15px;
      }

      .bottom-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-top: var(--spacing-lg);
      }

      .hint {
        font-size: 12px;
        color: var(--text-tertiary);
      }

      .button {
        padding: var(--spacing-md) var(--spacing-lg);
        border: none;
        border-radius: var(--border-radius-small);
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        transition: background 0.2s ease;
        min-width: 100px;
      }

      .button-primary {
        background: var(--primary-color);
        color: white;
      }

      .button-primary:hover {
        background: var(--primary-hover);
      }
    `,
  ];

  async connectedCallback() {
    super.connectedCallback();
    await this.loadRound('mid');
  }

  private async loadRound(zone: Zone) {
    this.loading = true;
    this.currentZone = zone;
    this.knownWords = new Set();
    try {
      const { minPos, maxPos } = ZONES[zone];
      this.words = await window.electronAPI.frequency.getAssessmentWords(
        this.language,
        minPos,
        maxPos
      );
    } catch {
      this.words = [];
    } finally {
      this.loading = false;
    }
  }

  private get roundNumber() {
    return this.roundScores.length + 1;
  }

  private get totalRounds() {
    // 2 base rounds, possibly a 3rd tiebreak
    return this.roundScores.length >= 1 && this.isCurrentRoundTiebreak() ? 3 : 2;
  }

  private isCurrentRoundTiebreak() {
    return this.currentZone === 'high2' || this.currentZone === 'low2';
  }

  private toggleWord(word: string) {
    const next = new Set(this.knownWords);
    if (next.has(word)) {
      next.delete(word);
    } else {
      next.add(word);
    }
    this.knownWords = next;
  }

  private async handleContinue() {
    const known = this.knownWords.size;
    const total = this.words.length;
    this.roundScores.push({ zone: this.currentZone, known, total });

    const nextZone = this.nextZone(known, total);
    if (nextZone) {
      await this.loadRound(nextZone);
    } else {
      this.dispatchEvent(
        new CustomEvent('proficiency-selected', {
          detail: { level: this.computeLevel() },
          bubbles: true,
          composed: true,
        })
      );
    }
  }

  private nextZone(known: number, total: number): Zone | null {
    const high = known >= Math.ceil(total * 0.6); // ≥60% = comfortable
    const low = known <= Math.floor(total * 0.35); // ≤35% = unfamiliar
    const borderline = !high && !low; // 36–59%

    switch (this.currentZone) {
      case 'mid':
        return high ? 'high' : 'low';
      case 'high':
        return borderline ? 'high2' : null;
      case 'low':
        return borderline ? 'low2' : null;
      case 'high2':
      case 'low2':
        return null;
    }
  }

  private computeLevel(): ProficiencyLevel {
    for (const { zone, known, total } of this.roundScores) {
      const comfortable = known >= Math.ceil(total * 0.5);
      if (zone === 'high' || zone === 'high2') {
        if (zone === 'high2') return comfortable ? 'b1' : 'a2';
        // high without tiebreak: clear result
        const { known: hKnown, total: hTotal } = this.roundScores.find(
          (r) => r.zone === 'high'
        ) ?? { known, total };
        return hKnown >= Math.ceil(hTotal * 0.6) ? 'b1' : 'a2';
      }
    }

    // Determine from low/low2 round
    const lowRound =
      this.roundScores.find((r) => r.zone === 'low2') ??
      this.roundScores.find((r) => r.zone === 'low');
    if (lowRound) {
      return lowRound.known >= Math.ceil(lowRound.total * 0.5) ? 'a1' : 'newbie';
    }

    return 'newbie';
  }

  private handleCancel() {
    this.dispatchEvent(new CustomEvent('proficiency-cancelled', { bubbles: true, composed: true }));
  }

  private get roundTitle(): string {
    if (this.roundNumber === 1) {
      const lang = this.language.charAt(0).toUpperCase() + this.language.slice(1);
      return `How much ${lang} do you know?`;
    }
    return 'And these?';
  }

  render() {
    const completed = this.roundScores.length;
    const total = this.totalRounds;

    return html`
      <div
        class="modal-overlay"
        @click=${(e: Event) => {
          if (e.target === e.currentTarget) this.handleCancel();
        }}
      >
        <div class="modal-content">
          <h2 class="modal-title">${this.roundTitle}</h2>
          <p class="modal-subtitle">Hover to see the meaning, click words you know</p>

          <div class="progress-dots">
            ${Array.from({ length: total }).map(
              (_, i) => html`
                <div class="dot ${i < completed ? 'done' : i === completed ? 'active' : ''}"></div>
              `
            )}
          </div>

          ${this.loading
            ? html`<div class="loading">Loading…</div>`
            : html`
                <div class="word-grid">
                  ${this.words.map(
                    (w) => html`
                      <div
                        class="word-chip ${this.knownWords.has(w.word) ? 'known' : ''}"
                        @click=${() => this.toggleWord(w.word)}
                        @mouseenter=${() => (this.hoveredWord = w.word)}
                        @mouseleave=${() => (this.hoveredWord = null)}
                      >
                        ${w.word}
                        ${this.hoveredWord === w.word
                          ? html`<div class="translation-tooltip">${w.translation}</div>`
                          : ''}
                      </div>
                    `
                  )}
                </div>
              `}

          <div class="bottom-row">
            <span class="hint">
              ${this.knownWords.size === 0
                ? 'Click words you know'
                : `${this.knownWords.size} / ${this.words.length} selected`}
            </span>
            <button class="button button-primary" @click=${this.handleContinue}>Continue</button>
          </div>
        </div>
      </div>
    `;
  }
}
