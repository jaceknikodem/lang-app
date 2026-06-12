import { css, type CSSResultGroup } from 'lit';
import { pronunciationStyles } from '../styles/pronunciation.styles.js';

const sentenceViewerOwnStyles = css`
  :host {
    display: block;
    width: 100%;
    max-width: 100%;
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  .sentence-container {
    background: var(--background-primary);
    border-radius: var(--border-radius);
    padding: var(--spacing-lg);
    box-shadow: var(--shadow-light);
    border: 1px solid var(--border-color);
    width: 100%;
    max-width: 100%;
    min-width: 0;
    box-sizing: border-box;
    margin: 0;
  }

  .sentence-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: var(--spacing-sm);
    flex-wrap: wrap;
    gap: var(--spacing-sm);
    width: 100%;
    box-sizing: border-box;
  }

  .target-word-info {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    flex: 1;
    min-width: 0;
  }

  .target-word {
    font-size: 16px;
    font-weight: 700;
    color: var(--primary-color);
    position: relative;
    display: inline-block;
  }

  .target-word:hover .word-reading-tooltip {
    display: flex;
  }

  .target-word .word-reading-tooltip {
    left: 0;
    transform: none;
  }

  .target-word .word-reading-tooltip::after {
    left: 16px;
    transform: none;
  }

  .word-separator {
    font-size: 16px;
    font-weight: 700;
    color: var(--text-primary);
    margin: 0 var(--spacing-sm);
  }

  .word-translation {
    font-size: 16px;
    color: var(--text-primary);
    font-weight: 400;
  }

  .audio-button {
    background: var(--background-primary);
    border: 1px solid var(--border-color);
    border-radius: 999px;
    padding: 4px 8px;
    font-size: 14px;
    color: var(--text-secondary);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: all 0.2s ease;
    width: 32px;
    height: 32px;
    line-height: 1;
    flex-shrink: 0;
  }

  .audio-button:hover:not(:disabled) {
    border-color: var(--primary-color);
    color: var(--primary-color);
    background: rgba(0, 0, 0, 0.03);
  }

  .audio-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .audio-icon {
    width: 16px;
    height: 16px;
  }

  .audio-button.secondary {
    background: var(--background-primary);
    border: 1px solid var(--border-color);
    color: var(--text-secondary);
  }

  .audio-button.secondary:hover:not(:disabled) {
    border-color: var(--primary-color);
    color: var(--primary-color);
    background: rgba(0, 0, 0, 0.03);
  }

  .word-strength {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-secondary);
    background: var(--background-secondary);
    border-radius: var(--border-radius-small);
    padding: 2px 6px;
    line-height: 1;
  }

  .last-seen {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-secondary);
    background: var(--background-secondary);
    border-radius: var(--border-radius-small);
    padding: 2px 6px;
    line-height: 1;
  }

  .word-strength-value {
    color: var(--primary-color);
  }

  .sentence-content {
    margin-bottom: var(--spacing-md);
    width: 100%;
    box-sizing: border-box;
  }

  .context-section {
    margin-bottom: var(--spacing-sm);
    padding: var(--spacing-md);
    background: var(--background-secondary);
    border-radius: var(--border-radius-small);
    border-left: 2px solid var(--primary-color);
    transition: all 0.3s ease;
    cursor: pointer;
  }

  .context-section.playing {
    background: #e3f2fd;
  }

  .context-label {
    font-size: 10px;
    font-weight: 600;
    color: var(--primary-color);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: var(--spacing-xs);
  }

  .context-text {
    font-size: 21px;
    line-height: 1.4;
    color: var(--text-primary);
    margin-bottom: var(--spacing-xs);
  }

  .context-translation {
    font-size: 12px;
    color: var(--text-secondary);
    font-style: italic;
  }

  .context-translation.hidden {
    opacity: 0.1;
    filter: blur(8px);
    pointer-events: none;
    user-select: none;
  }

  .sentence-text {
    font-size: 27px;
    line-height: 1.5;
    margin-bottom: var(--spacing-sm);
    color: var(--text-primary);
    width: 100%;
    word-wrap: break-word;
    overflow-wrap: break-word;
    hyphens: auto;
    padding: var(--spacing-md);
    padding-right: var(--spacing-md);
    background: var(--background-secondary);
    border-radius: var(--border-radius-small);
    border-left: 2px solid var(--primary-color);
    transition: all 0.3s ease;
    box-sizing: border-box;
    cursor: pointer;
  }

  .sentence-text.playing {
    background: #e3f2fd;
  }

  .sentence-translation {
    font-size: 14px;
    color: var(--text-secondary);
    font-style: italic;
    line-height: 1.4;
    margin-top: var(--spacing-xs);
  }

  .sentence-translation.hidden {
    opacity: 0.1;
    filter: blur(8px);
    pointer-events: none;
    user-select: none;
  }

  .word-in-sentence {
    cursor: pointer;
    padding: 2px 4px;
    border-radius: 3px;
    transition: all 0.2s ease;
    position: relative;
    display: inline-block;
    vertical-align: baseline;
    border: 2px solid transparent;
    box-sizing: border-box;
  }

  .japanese-words {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    align-items: baseline;
  }

  .word-in-sentence:hover {
    transform: translateY(-1px);
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  }

  /* Word strength and status colors */
  .word-neutral {
    background-color: transparent;
  }

  .word-target {
    background-color: var(--primary-light);
    border: 2px solid transparent;
  }

  .word-known {
    background-color: #c8e6c9;
    color: #2e7d32;
  }

  .word-ignored {
    background-color: #f5f5f5;
    color: #999;
    text-decoration: line-through;
  }

  .word-strength-0 {
    background-color: #ffebee;
  } /* Very weak - light red */
  .word-strength-1 {
    background-color: #fff3e0;
  } /* Weak - light orange */
  .word-strength-2 {
    background-color: #fffde7;
  } /* Learning - light yellow */
  .word-strength-3 {
    background-color: #f3e5f5;
  } /* Good - light purple */
  .word-strength-4 {
    background-color: #e8f5e8;
  } /* Strong - light green */

  .word-actions {
    display: flex;
    justify-content: center;
    gap: var(--spacing-md);
    margin-top: var(--spacing-md);
    flex-wrap: wrap;
  }

  .word-action-btn,
  .nav-action-btn {
    min-width: 100px;
  }

  /* Toned down colors for action buttons */
  .word-action-btn.btn-success {
    background: #e8f5e9;
    color: #2e7d32;
    border: 1px solid #81c784;
  }

  .word-action-btn.btn-success:hover:not(:disabled) {
    background: #c8e6c9;
    border-color: #66bb6a;
  }

  .word-action-btn.btn-danger {
    background: #ffebee;
    color: #c62828;
    border: 1px solid #ef5350;
  }

  .word-action-btn.btn-danger:hover:not(:disabled) {
    background: #ffcdd2;
    border-color: #e57373;
  }

  .word-action-btn.btn-warning {
    background: #fff3e0;
    color: #e65100;
    border: 1px solid #ffb74d;
  }

  .word-action-btn.btn-warning:hover:not(:disabled) {
    background: #ffe0b2;
    border-color: #ffa726;
  }

  .tooltip {
    position: absolute;
    bottom: 100%;
    left: 0;
    transform: none;
    background: var(--text-primary);
    color: white;
    padding: var(--spacing-xs) var(--spacing-sm);
    border-radius: var(--border-radius-small);
    font-size: 12px;
    white-space: normal;
    max-width: 600px;
    min-width: 150px;
    width: fit-content;
    word-wrap: break-word;
    overflow-wrap: break-word;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.2s ease;
    z-index: 10;
    margin-bottom: var(--spacing-xs);
  }

  .tooltip.left {
    left: auto;
    right: 0;
  }

  .word-in-sentence:hover .tooltip {
    opacity: 1;
  }

  .tooltip::after {
    content: '';
    position: absolute;
    top: 100%;
    left: 14px;
    transform: none;
    border: 4px solid transparent;
    border-top-color: var(--text-primary);
  }

  .tooltip.left::after {
    left: auto;
    right: 14px;
  }

  @media (max-width: 768px) {
    .sentence-header {
      flex-direction: column;
      align-items: stretch;
    }

    .target-word-info {
      justify-content: center;
    }

    .sentence-text {
      font-size: 22px;
    }

    .word-actions {
      flex-direction: column;
    }

    .word-action-btn,
    .nav-action-btn {
      width: 100%;
    }
  }
`;

export const sentenceViewerStyles: CSSResultGroup = [pronunciationStyles, sentenceViewerOwnStyles];
