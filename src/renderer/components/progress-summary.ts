/**
 * Progress summary component for displaying study statistics and word knowledge status
 */

import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { sharedStyles } from '../styles/shared.js';
import { router } from '../utils/router.js';
import { Word } from '../../shared/types/core.js';

interface WordCategoryStats {
  known: number;           // strength > STRONG_THRESHOLD
  strong: number;           // strength WEAK_THRESHOLD to STRONG_THRESHOLD
  weak: number;            // strength < WEAK_THRESHOLD (and has been studied)
  new: number;             // never studied (lastStudied is null)
}


@customElement('progress-summary')
export class ProgressSummary extends LitElement {
  // Strength thresholds for word categorization
  private static readonly WEAK_THRESHOLD = 30;
  private static readonly STRONG_THRESHOLD = 80;

  @state()
  private wordCategoryStats: WordCategoryStats | null = null;

  @state()
  private isLoading = true;

  @state()
  private error = '';

  @state()
  private currentLanguage = '';

  static styles = [
    sharedStyles,
    css`
      :host {
        display: block;
        max-width: 800px;
        margin: 0 auto;
        padding: var(--spacing-xl);
      }

      .stats-container {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--spacing-lg);
      }

      .stats-row {
        display: flex;
        gap: var(--spacing-md);
        align-items: center;
        justify-content: center;
        flex-wrap: wrap;
      }

      .stat-box {
        position: relative;
        display: flex;
        align-items: center;
        gap: var(--spacing-xs);
        padding: var(--spacing-sm) var(--spacing-md);
        border-radius: var(--border-radius);
        cursor: help;
      }

      .stat-box .stat-emoji {
        font-size: 24px;
        line-height: 1;
      }

      .stat-box .stat-value {
        font-size: 20px;
        font-weight: 600;
        color: var(--text-primary);
      }

      .stat-box.known {
        background: rgba(76, 175, 80, 0.1);
      }

      .stat-box.known .stat-value {
        color: #4caf50;
      }

      .stat-box.strong {
        background: rgba(33, 150, 243, 0.1);
      }

      .stat-box.strong .stat-value {
        color: #2196f3;
      }

      .stat-box.weak {
        background: rgba(255, 152, 0, 0.1);
      }

      .stat-box.weak .stat-value {
        color: #ff9800;
      }

      .stat-box.new {
        background: rgba(158, 158, 158, 0.1);
      }

      .stat-box.new .stat-value {
        color: #9e9e9e;
      }

      .tooltip {
        position: absolute;
        bottom: 100%;
        left: 50%;
        transform: translateX(-50%);
        margin-bottom: var(--spacing-xs);
        padding: var(--spacing-sm) var(--spacing-md);
        background: var(--background-primary);
        border: 1px solid var(--border-color);
        border-radius: var(--border-radius-small);
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
        white-space: nowrap;
        font-size: 12px;
        color: var(--text-primary);
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.2s ease;
        z-index: 1000;
      }

      .stat-box:hover .tooltip {
        opacity: 1;
      }

      .loading-container {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: var(--spacing-xl);
        gap: var(--spacing-md);
      }

      .error-message {
        color: var(--error-color);
        background: #ffebee;
        padding: var(--spacing-md);
        border-radius: var(--border-radius);
        border: 1px solid #ffcdd2;
        text-align: center;
      }

      .empty-state {
        text-align: center;
        padding: var(--spacing-xl);
        color: var(--text-secondary);
      }
    `
  ];

  connectedCallback() {
    super.connectedCallback();
    // Listen for language changes
    document.addEventListener('language-changed', this.handleExternalLanguageChange);
    this.loadProgressData();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    // Clean up language change listener
    document.removeEventListener('language-changed', this.handleExternalLanguageChange);
  }

  private handleExternalLanguageChange = async (event: Event) => {
    const detail = (event as CustomEvent<{ language?: string }>).detail;
    const newLanguage = detail?.language;

    if (!newLanguage || newLanguage === this.currentLanguage) {
      return;
    }

    // Reload progress data for the new language
    await this.loadProgressData();
  };

  private async loadProgressData() {
    this.isLoading = true;
    this.error = '';

    try {
      // Load language information
      this.currentLanguage = await window.electronAPI.database.getCurrentLanguage();

      // Load all words for current language to calculate category statistics
      const allWords = await window.electronAPI.database.getAllWords(true, false, this.currentLanguage);
      this.wordCategoryStats = this.calculateWordCategoryStats(allWords);

    } catch (error) {
      console.error('Failed to load progress data:', error);
      this.error = 'Failed to load progress data. Please try again.';
    } finally {
      this.isLoading = false;
    }
  }

  private calculateWordCategoryStats(words: Word[]): WordCategoryStats {
    const stats: WordCategoryStats = {
      known: 0,
      strong: 0,
      weak: 0,
      new: 0
    };

    words.forEach(word => {
      if (!word.lastStudied) {
        // Not yet reviewed
        stats.new++;
      } else if (word.strength > ProgressSummary.STRONG_THRESHOLD) {
        // Confidently remembered (strength > 80)
        stats.known++;
      } else if (word.strength >= ProgressSummary.WEAK_THRESHOLD) {
        // Mostly remembered (30-80)
        stats.strong++;
      } else {
        // Shaky or forgotten (<30)
        stats.weak++;
      }
    });

    return stats;
  }


  render() {
    if (this.isLoading) {
      return html`
        <div class="stats-container">
          <div class="loading-container">
            <div class="loading">
              <div class="spinner"></div>
              Loading stats...
            </div>
          </div>
        </div>
      `;
    }

    if (this.error) {
      return html`
        <div class="stats-container">
          <div class="error-message">
            ${this.error}
          </div>
        </div>
      `;
    }

    if (!this.wordCategoryStats ||
      (this.wordCategoryStats.known + this.wordCategoryStats.strong +
        this.wordCategoryStats.weak + this.wordCategoryStats.new) === 0) {
      return html`
        <div class="stats-container">
          <div class="empty-state">
            <p>No learning progress yet. Start your first learning session!</p>
          </div>
        </div>
      `;
    }

    return html`
      <div class="stats-container">
        <div class="stats-row">
          <div class="stat-box known">
            <span class="stat-emoji">🟩</span>
            <span class="stat-value">${this.wordCategoryStats?.known || 0}</span>
            <div class="tooltip">Known: confidently remembered (strength > 80)</div>
          </div>
          
          <div class="stat-box strong">
            <span class="stat-emoji">🟦</span>
            <span class="stat-value">${this.wordCategoryStats?.strong || 0}</span>
            <div class="tooltip">Strong: mostly remembered (30–80)</div>
          </div>
          
          <div class="stat-box weak">
            <span class="stat-emoji">🟧</span>
            <span class="stat-value">${this.wordCategoryStats?.weak || 0}</span>
            <div class="tooltip">Weak: shaky or forgotten (&lt;30)</div>
          </div>
          
          <div class="stat-box new">
            <span class="stat-emoji">⚪</span>
            <span class="stat-value">${this.wordCategoryStats?.new || 0}</span>
            <div class="tooltip">New: not yet reviewed</div>
          </div>
        </div>
      </div>
    `;
  }
}
