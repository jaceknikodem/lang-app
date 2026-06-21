import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { hiraganaToRomaji } from '../utils/hiragana-romaji.js';

interface FuriganaToken {
  text: string;
  type: string;
  reading?: string;
}

/**
 * Renders Japanese text with furigana (ruby annotations) above kanji tokens.
 * Accepts an optional `keyword` to bold-highlight a specific word.
 * When `pronunciation` (hiragana) is provided, hovering the text reveals a romaji tooltip.
 * Falls back to plain text while readings are loading.
 */
@customElement('japanese-furigana-text')
export class JapaneseFuriganaText extends LitElement {
  @property({ type: String }) text = '';
  @property({ type: String }) keyword = '';
  @property({ type: String }) pronunciation = '';

  @state() private tokens: FuriganaToken[] = [];

  static styles = css`
    :host {
      display: inline;
      position: relative;
    }
    ruby {
      ruby-align: center;
    }
    rt {
      font-size: 0.45em;
      color: var(--text-secondary, #888);
      letter-spacing: 0.05em;
    }
    .kw {
      font-weight: bold;
      background: var(--primary-light, rgba(99, 102, 241, 0.15));
      border-radius: 2px;
      padding: 0 1px;
    }
    .romaji-tooltip {
      display: none;
      position: absolute;
      top: calc(100% + 4px);
      left: 0;
      background: #1a1a2e;
      border: 1px solid #444;
      border-radius: 8px;
      padding: 6px 10px;
      font-size: 12px;
      color: #9090b0;
      letter-spacing: 0.06em;
      white-space: nowrap;
      z-index: 100;
      pointer-events: none;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
    }
    :host(:hover) .romaji-tooltip {
      display: block;
    }
  `;

  updated(changed: Map<string, unknown>) {
    if (changed.has('text') && this.text) {
      void this.fetchFurigana();
    }
  }

  private async fetchFurigana() {
    const text = this.text;
    try {
      const tokens = await window.electronAPI.japaneseTokenization.tokenizeWithReadings(text);
      if (this.text === text) {
        this.tokens = tokens;
      }
    } catch {
      this.tokens = [{ text, type: 'word' }];
    }
  }

  render() {
    const content = this.tokens.length
      ? this.tokens.map((token) => {
          const isKeyword = !!this.keyword && token.text.trim() === this.keyword.trim();
          const core = token.reading
            ? html`<ruby>${token.text}<rt>${token.reading}</rt></ruby>`
            : token.text;
          return isKeyword ? html`<span class="kw">${core}</span>` : core;
        })
      : this.text || nothing;

    const romaji = this.pronunciation ? hiraganaToRomaji(this.pronunciation) : '';

    return html`${content}${romaji ? html`<span class="romaji-tooltip">${romaji}</span>` : nothing}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'japanese-furigana-text': JapaneseFuriganaText;
  }
}
