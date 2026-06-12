import { html, nothing, type TemplateResult } from 'lit';
import { hiraganaToRomaji } from './hiragana-romaji.js';

/**
 * Render a pronunciation line (hiragana) with a hover tooltip showing romaji.
 * Returns `nothing` when pronunciation is absent or blank.
 *
 * @param pronunciation - hiragana text (from sentence.pronunciation etc.)
 * @param cssClass - wrapper class: 'sentence-pronunciation' or 'context-pronunciation'
 */
export function renderPronunciation(
  pronunciation: string | undefined,
  cssClass: 'sentence-pronunciation' | 'context-pronunciation' = 'sentence-pronunciation'
): TemplateResult | typeof nothing {
  if (!pronunciation?.trim()) return nothing;
  return html`
    <div class="${cssClass}">
      ${pronunciation}
      <div class="word-reading-tooltip">
        <span class="tooltip-romaji">${hiraganaToRomaji(pronunciation)}</span>
      </div>
    </div>
  `;
}
