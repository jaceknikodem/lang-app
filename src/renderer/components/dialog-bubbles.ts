import { LitElement, html, css, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { Sentence, DialogueVariant } from '../../shared/types/core.js';
import {
  getSimilarityThresholds,
  getSimilarityClass,
  type ProficiencyLevel,
} from '../../shared/utils/similarity-threshold.js';
import { pronunciationStyles } from '../styles/pronunciation.styles.js';
import { renderPronunciation } from '../utils/pronunciation-render.js';
import './japanese-furigana-text.js';

export interface TranscriptionResult {
  text: string;
  similarity: number;
  normalizedTranscribed: string;
  normalizedExpected: string;
  expectedWords: Array<{ word: string; similarity: number; matched: boolean }>;
  transcribedWords: string[];
}

@customElement('dialog-bubbles')
export class DialogBubbles extends LitElement {
  @property({ attribute: false }) sentence: Sentence | null = null;
  @property({ attribute: false }) transcriptionResult: TranscriptionResult | null = null;
  @property({ type: String }) followUpText = '';
  @property({ type: String }) followUpTranslation = '';
  @property({ type: String }) followUpPronunciation = '';
  @property({ type: String }) followUpAudio: string | null = null;
  @property({ type: Boolean }) showFollowUp = false;
  @property({ type: Boolean }) isGeneratingFollowUp = false;
  @property({ type: Boolean }) isTopicBasedFlow = false;
  @property({ type: Boolean }) isLoadingVariants = false;
  @property({ attribute: false }) responseOptions: DialogueVariant[] = [];
  @property({ attribute: false }) selectedOption: DialogueVariant | null = null;
  @property({ type: Boolean }) showTranslations = true;
  @property({ attribute: false }) previousCorrections: string[] = [];
  @property({ attribute: false }) proficiencyLevel: ProficiencyLevel | null = null;
  @property({ type: Boolean }) isRecording = false;
  @property({ type: String }) beforeSentenceAudio: string | null = null;

  static styles = [
    pronunciationStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-md);
        width: 100%;
        max-width: 600px;
        margin: 0 auto;
      }

      .dialog-bubble {
        padding: var(--spacing-md) var(--spacing-lg);
        border-radius: 18px;
        max-width: 75%;
        position: relative;
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
      }

      .bubble-left {
        align-self: flex-start;
        background: var(--background-secondary);
        border-top-left-radius: 4px;
      }

      .bubble-left.has-audio {
        cursor: pointer;
        transition: background 0.15s ease;
      }

      .bubble-left.has-audio:hover {
        background: color-mix(in srgb, var(--background-secondary) 80%, var(--primary-color) 20%);
      }

      .bubble-right {
        align-self: flex-end;
        background: var(--primary-color);
        color: white;
        border-top-right-radius: 4px;
      }

      .bubble-content {
        flex: 1;
      }

      .bubble-text-container {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        flex-wrap: wrap;
      }

      .bubble-text {
        font-size: 16px;
        margin: 0;
        line-height: 2.2;
        flex: 1;
      }

      .bubble-text span {
        display: inline;
        transition: color 0.2s ease;
      }

      .bubble-right .bubble-text {
        color: white;
      }

      .bubble-translation {
        font-size: 14px;
        margin: var(--spacing-xs) 0 0 0;
        opacity: 0.8;
        font-style: italic;
      }

      .bubble-right .bubble-translation {
        color: rgba(255, 255, 255, 0.9);
      }

      .similarity-badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: var(--spacing-xs) var(--spacing-sm);
        border-radius: var(--border-radius-small);
        font-size: 12px;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
        min-width: 45px;
        white-space: nowrap;
      }

      .similarity-badge.excellent {
        background: var(--success-light);
        color: var(--success-color);
      }
      .similarity-badge.good {
        background: #d4edda;
        color: #28a745;
      }
      .similarity-badge.fair {
        background: #fff3cd;
        color: #856404;
      }
      .similarity-badge.poor {
        background: var(--error-light);
        color: var(--error-color);
      }

      .bubble-right .similarity-badge {
        background: rgba(255, 255, 255, 0.2);
        color: white;
      }
      .bubble-right .similarity-badge.excellent {
        background: rgba(52, 199, 89, 0.3);
        color: white;
      }
      .bubble-right .similarity-badge.good {
        background: rgba(40, 167, 69, 0.3);
        color: white;
      }
      .bubble-right .similarity-badge.fair {
        background: rgba(255, 193, 7, 0.3);
        color: white;
      }
      .bubble-right .similarity-badge.poor {
        background: rgba(255, 59, 48, 0.3);
        color: white;
      }

      .try-again-button {
        font-size: 14px;
        padding: var(--spacing-sm) var(--spacing-md);
        margin-top: var(--spacing-sm);
        width: 100%;
        background: var(--primary-color);
        color: white;
        border: none;
        border-radius: var(--border-radius-small);
        cursor: pointer;
      }

      .previous-corrections {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-xs);
        margin-top: var(--spacing-sm);
        margin-bottom: var(--spacing-sm);
        padding: var(--spacing-sm);
        background: var(--background-secondary);
        border-radius: 8px;
        border: 1px solid var(--border-color);
      }

      .previous-correction-item {
        display: flex;
        align-items: flex-start;
        gap: var(--spacing-xs);
        font-size: 13px;
        color: var(--text-secondary);
        line-height: 1.4;
      }

      .correction-label {
        flex-shrink: 0;
        font-size: 14px;
      }
      .correction-text {
        flex: 1;
        font-style: italic;
      }

      .response-options {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-sm);
        width: 100%;
      }

      .response-option {
        padding: var(--spacing-sm) var(--spacing-md);
        border-radius: var(--border-radius-small);
        border: 1px solid #ccc;
        background: var(--background-primary);
        cursor: pointer;
        transition:
          background 0.15s ease,
          border-color 0.15s ease;
      }

      .response-option:hover {
        background: var(--background-secondary);
        border-color: var(--primary-color);
      }

      .response-option.has-audio:active {
        background: color-mix(in srgb, var(--primary-color) 10%, var(--background-primary));
      }

      .response-option .sentence {
        font-size: 18px;
        margin: 0 0 var(--spacing-xs) 0;
      }
      .response-option .translation {
        font-size: 14px;
        color: var(--text-secondary);
        margin: 0;
      }

      .typing-indicator {
        display: flex;
        align-items: center;
        gap: 4px;
        min-height: 24px;
      }

      .typing-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--text-secondary);
        opacity: 0.7;
        animation: typing-bounce 1.4s ease-in-out infinite;
      }

      .typing-dot:nth-child(1) {
        animation-delay: 0s;
      }
      .typing-dot:nth-child(2) {
        animation-delay: 0.2s;
      }
      .typing-dot:nth-child(3) {
        animation-delay: 0.4s;
      }

      @keyframes typing-bounce {
        0%,
        60%,
        100% {
          transform: translateY(0);
          opacity: 0.7;
        }
        30% {
          transform: translateY(-8px);
          opacity: 1;
        }
      }
    `,
  ];

  private parseSentenceWords(
    text: string
  ): Array<{ word: string; normalized: string; trailing: string; leading: string }> {
    const words: Array<{ word: string; normalized: string; trailing: string; leading: string }> =
      [];
    const wordRegex = /[\p{L}\p{N}]+/gu;
    let lastIndex = 0;
    let match;

    while ((match = wordRegex.exec(text)) !== null) {
      const leading = match.index > lastIndex ? text.substring(lastIndex, match.index) : '';
      const normalized = match[0].toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
      words.push({ word: match[0], normalized, trailing: '', leading });
      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < text.length && words.length > 0) {
      words[words.length - 1].trailing = text.substring(lastIndex);
    }

    return words;
  }

  private getWordColor(wordInfo: { word: string; similarity: number; matched: boolean }): string {
    if (!wordInfo.matched) return '#ffcccc';
    if (wordInfo.similarity >= 0.9) return '#ccffcc';
    return '#ffffcc';
  }

  private renderUserBubble(
    userText: string,
    userTranslation: string,
    similarity?: number,
    expectedWords?: Array<{ word: string; similarity: number; matched: boolean }>
  ): TemplateResult {
    let bubbleTextContent: TemplateResult;
    if (expectedWords && expectedWords.length > 0) {
      const parsedWords = this.parseSentenceWords(userText);
      const wordElements: TemplateResult[] = [];
      let expectedWordIndex = 0;

      for (const parsedWord of parsedWords) {
        let wordInfo: { word: string; similarity: number; matched: boolean } | null = null;

        if (expectedWordIndex < expectedWords.length) {
          const expectedWord = expectedWords[expectedWordIndex];
          const expectedNormalized = expectedWord.word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
          if (
            parsedWord.normalized === expectedNormalized ||
            parsedWord.normalized.startsWith(expectedNormalized) ||
            expectedNormalized.startsWith(parsedWord.normalized)
          ) {
            wordInfo = expectedWord;
            expectedWordIndex++;
          } else {
            for (let i = expectedWordIndex + 1; i < expectedWords.length; i++) {
              const otherNormalized = expectedWords[i].word
                .toLowerCase()
                .replace(/[^\p{L}\p{N}]/gu, '');
              if (parsedWord.normalized === otherNormalized) {
                wordInfo = expectedWords[i];
                expectedWordIndex = i + 1;
                break;
              }
            }
          }
        }

        const color = wordInfo ? this.getWordColor(wordInfo) : 'white';
        wordElements.push(html`
          ${parsedWord.leading}<span
            style="color: ${color}; font-weight: ${wordInfo && !wordInfo.matched
              ? 'bold'
              : 'normal'};"
            >${parsedWord.word} </span
          >${parsedWord.trailing}
        `);
      }
      bubbleTextContent = html`${wordElements}`;
    } else {
      bubbleTextContent = html`${userText}`;
    }

    const thresholds = getSimilarityThresholds(this.proficiencyLevel);
    const belowThreshold = similarity !== undefined && similarity < thresholds.successThreshold;

    return html`
      <div class="dialog-bubble bubble-right">
        <div class="bubble-content">
          <div class="bubble-text-container">
            <p class="bubble-text">${bubbleTextContent}</p>
            ${similarity !== undefined
              ? html`
                  <span
                    class="similarity-badge ${getSimilarityClass(
                      similarity,
                      this.proficiencyLevel
                    )}"
                  >
                    ${Math.round(similarity * 100)}%
                  </span>
                `
              : nothing}
          </div>
          ${this.showTranslations && userTranslation
            ? html`<p class="bubble-translation">${userTranslation}</p>`
            : nothing}
          ${belowThreshold
            ? html`
                <button
                  class="try-again-button"
                  @click=${() =>
                    this.dispatchEvent(
                      new CustomEvent('start-recording', { bubbles: true, composed: true })
                    )}
                >
                  Try Again
                </button>
              `
            : nothing}
        </div>
      </div>
    `;
  }

  render() {
    const isJapanese =
      this.sentence?.language?.toLowerCase() === 'japanese' ||
      this.sentence?.language?.toLowerCase() === 'ja';

    return html`
      ${this.sentence?.contextBefore
        ? html`
            <div
              class="dialog-bubble bubble-left ${this.beforeSentenceAudio ? 'has-audio' : ''}"
              @click=${() => {
                if (this.beforeSentenceAudio) {
                  this.dispatchEvent(
                    new CustomEvent('play-variant-audio', {
                      detail: { audioPath: this.beforeSentenceAudio },
                      bubbles: true,
                      composed: true,
                    })
                  );
                }
              }}
              title=${this.beforeSentenceAudio ? 'Click to hear pronunciation' : ''}
            >
              <div class="bubble-content">
                <p class="bubble-text">
                  ${isJapanese
                    ? html`<japanese-furigana-text
                        .text=${this.sentence.contextBefore}
                        .pronunciation=${this.sentence.contextBeforePronunciation ?? ''}
                      ></japanese-furigana-text>`
                    : this.sentence.contextBefore}
                </p>
                ${isJapanese
                  ? nothing
                  : renderPronunciation(
                      this.sentence.contextBeforePronunciation,
                      'context-pronunciation'
                    )}
                ${this.showTranslations && this.sentence.contextBeforeTranslation
                  ? html`<p class="bubble-translation">
                      ${this.sentence.contextBeforeTranslation}
                    </p>`
                  : nothing}
              </div>
            </div>
            ${this.isTopicBasedFlow && this.previousCorrections.length > 0
              ? html`
                  <div class="previous-corrections">
                    ${this.previousCorrections
                      .filter((c) => c.length < 100)
                      .map(
                        (c) => html`
                          <div class="previous-correction-item">
                            <span class="correction-label">💡</span>
                            <span class="correction-text">${c}</span>
                          </div>
                        `
                      )}
                  </div>
                `
              : nothing}
          `
        : nothing}
      ${this.transcriptionResult
        ? html`
            ${this.renderUserBubble(
              this.transcriptionResult.text,
              this.isTopicBasedFlow ? '' : this.selectedOption?.variantTranslation || '',
              this.isTopicBasedFlow ? undefined : this.transcriptionResult.similarity,
              this.isTopicBasedFlow ? undefined : this.transcriptionResult.expectedWords
            )}
          `
        : !this.isTopicBasedFlow && this.isLoadingVariants
          ? html`
              <div class="response-options">
                <p class="translation typing-indicator">
                  <span class="typing-dot"></span>
                  <span class="typing-dot"></span>
                  <span class="typing-dot"></span>
                </p>
              </div>
            `
          : !this.isTopicBasedFlow && this.responseOptions.length > 0
            ? html`
                <div class="response-options">
                  ${this.responseOptions.map(
                    (option) => html`
                      <div
                        class="response-option ${option.variantSentenceAudio ? 'has-audio' : ''}"
                        @click=${() => {
                          if (option.variantSentenceAudio) {
                            this.dispatchEvent(
                              new CustomEvent('play-variant-audio', {
                                detail: { audioPath: option.variantSentenceAudio },
                                bubbles: true,
                                composed: true,
                              })
                            );
                          }
                        }}
                        title=${option.variantSentenceAudio ? 'Click to hear pronunciation' : ''}
                      >
                        <p class="sentence">
                          ${isJapanese
                            ? html`<japanese-furigana-text
                                .text=${option.variantSentence}
                                .pronunciation=${option.variantPronunciation ?? ''}
                              ></japanese-furigana-text>`
                            : option.variantSentence}
                        </p>
                        ${isJapanese
                          ? nothing
                          : renderPronunciation(
                              option.variantPronunciation,
                              'context-pronunciation'
                            )}
                        ${this.showTranslations
                          ? html`<p class="translation">${option.variantTranslation}</p>`
                          : nothing}
                      </div>
                    `
                  )}
                </div>
              `
            : nothing}
      ${this.isGeneratingFollowUp
        ? html`
            <div class="dialog-bubble bubble-left">
              <div class="bubble-content">
                <p class="bubble-text typing-indicator">
                  <span class="typing-dot"></span>
                  <span class="typing-dot"></span>
                  <span class="typing-dot"></span>
                </p>
              </div>
            </div>
          `
        : nothing}
      ${this.showFollowUp && this.followUpText
        ? html`
            <div
              class="dialog-bubble bubble-left ${this.followUpAudio ? 'has-audio' : ''}"
              @click=${() => {
                if (this.followUpAudio) {
                  this.dispatchEvent(
                    new CustomEvent('play-variant-audio', {
                      detail: { audioPath: this.followUpAudio },
                      bubbles: true,
                      composed: true,
                    })
                  );
                }
              }}
              title=${this.followUpAudio ? 'Click to hear pronunciation' : ''}
            >
              <div class="bubble-content">
                <p class="bubble-text">
                  ${isJapanese
                    ? html`<japanese-furigana-text
                        .text=${this.followUpText}
                        .pronunciation=${this.followUpPronunciation ?? ''}
                      ></japanese-furigana-text>`
                    : this.followUpText}
                </p>
                ${isJapanese
                  ? nothing
                  : renderPronunciation(this.followUpPronunciation, 'context-pronunciation')}
                ${this.showTranslations && this.followUpTranslation
                  ? html`<p class="bubble-translation">${this.followUpTranslation}</p>`
                  : nothing}
              </div>
            </div>
          `
        : nothing}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'dialog-bubbles': DialogBubbles;
  }
}
