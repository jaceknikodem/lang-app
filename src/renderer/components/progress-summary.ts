/**
 * Progress summary component for displaying study statistics and word knowledge status
 */

import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { sharedStyles } from '../styles/shared.js';
import { router } from '../utils/router.js';
import { Word, StudyStats } from '../../shared/types/core.js';
import { sessionManager } from '../utils/session-manager.js';

interface WordCategoryStats {
  known: number;           // strength > STRONG_THRESHOLD
  learningStrong: number;  // strength WEAK_THRESHOLD to STRONG_THRESHOLD
  learningWeak: number;    // strength < WEAK_THRESHOLD
  new: number;             // never studied (lastStudied is null)
}


@customElement('progress-summary')
export class ProgressSummary extends LitElement {
  // Strength thresholds for word categorization
  private static readonly WEAK_THRESHOLD = 30;
  private static readonly STRONG_THRESHOLD = 80;

  @state()
  private studyStats: StudyStats | null = null;

  @state()
  private wordCategoryStats: WordCategoryStats | null = null;

  @state()
  private recentSessions: Array<{ id: number, wordsStudied: number, whenStudied: Date }> = [];

  @state()
  private isLoading = true;

  @state()
  private error = '';

  @state()
  private currentLanguage = '';

  @state()
  private languageStats: Array<{language: string, totalWords: number, studiedWords: number}> = [];

  static styles = [
    sharedStyles,
    css`
      :host {
        display: block;
        max-width: 1000px;
        margin: 0 auto;
      }

      .progress-container {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-lg);
      }

      .progress-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        gap: var(--spacing-lg);
        margin-top: var(--spacing-lg);
      }

      .progress-section {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-md);
      }

      .progress-header {
        text-align: center;
      }

      .progress-title {
        font-size: 20px;
        font-weight: 600;
        color: var(--text-primary);
        margin: 0 0 var(--spacing-sm) 0;
      }

      .progress-subtitle {
        font-size: 14px;
        color: var(--text-secondary);
        margin: 0;
      }

      .stats-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: var(--spacing-md);
      }

      .stat-card {
        background: var(--background-secondary);
        border: 1px solid var(--border-color);
        border-radius: var(--border-radius);
        padding: var(--spacing-lg);
        text-align: center;
        position: relative;
        overflow: hidden;
      }

      .stat-card.known {
        border-color: var(--success-color);
      }

      .stat-card.known .stat-value {
        color: var(--success-color);
      }

      .stat-card.learning-strong {
        border-color: var(--primary-color);
      }

      .stat-card.learning-strong .stat-value {
        color: var(--primary-color);
      }

      .stat-card.learning-weak {
        border-color: var(--warning-color);
      }

      .stat-card.learning-weak .stat-value {
        color: var(--warning-color);
      }

      .stat-card.new {
        border-color: var(--text-tertiary);
      }

      .stat-card.new .stat-value {
        color: var(--text-secondary);
      }

      .stat-value {
        font-size: 36px;
        font-weight: 700;
        color: var(--primary-color);
        margin: 0 0 var(--spacing-xs) 0;
      }

      .stat-label {
        font-size: 14px;
        color: var(--text-secondary);
        margin: 0;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .stat-description {
        font-size: 12px;
        color: var(--text-tertiary);
        margin: var(--spacing-xs) 0 0 0;
      }

      .section-title {
        font-size: 20px;
        font-weight: 600;
        color: var(--text-primary);
        margin: 0 0 var(--spacing-md) 0;
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
      }

      .section-icon {
        font-size: 24px;
      }

      .sessions-list {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-sm);
        max-height: 400px;
        overflow-y: auto;
      }

      .session-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: var(--spacing-md);
        background: var(--background-secondary);
        border: 1px solid var(--border-color);
        border-radius: var(--border-radius);
      }

      .session-info {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-xs);
      }

      .session-words {
        font-size: 16px;
        font-weight: 500;
        color: var(--text-primary);
      }

      .session-date {
        font-size: 14px;
        color: var(--text-secondary);
      }

      .session-badge {
        background: var(--primary-color);
        color: white;
        padding: var(--spacing-xs) var(--spacing-sm);
        border-radius: 12px;
        font-size: 12px;
        font-weight: 500;
      }

      .empty-state {
        text-align: center;
        padding: var(--spacing-xl);
        color: var(--text-secondary);
      }

      .empty-state h3 {
        color: var(--text-primary);
        margin-bottom: var(--spacing-md);
      }

      .action-buttons {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-md);
        align-items: stretch;
      }

      .error-message {
        color: var(--error-color);
        background: #ffebee;
        padding: var(--spacing-md);
        border-radius: var(--border-radius);
        border: 1px solid #ffcdd2;
        text-align: center;
      }

      .language-selector {
        display: flex;
        align-items: center;
        gap: var(--spacing-md);
        margin-bottom: var(--spacing-lg);
        padding: var(--spacing-md);
        background: var(--background-secondary);
        border: 1px solid var(--border-color);
        border-radius: var(--border-radius);
      }

      .language-selector label {
        font-weight: 500;
        color: var(--text-primary);
        white-space: nowrap;
      }

      .language-select {
        padding: var(--spacing-xs) var(--spacing-sm);
        border: 1px solid var(--border-color);
        border-radius: var(--border-radius-small);
        background: var(--background-primary);
        color: var(--text-primary);
        font-size: 14px;
        cursor: pointer;
        min-width: 150px;
      }

      .language-select:focus {
        outline: none;
        border-color: var(--primary-color);
        box-shadow: 0 0 0 2px rgba(0, 122, 204, 0.2);
      }

      .language-stats {
        flex: 1;
        display: flex;
        gap: var(--spacing-lg);
        font-size: 14px;
        color: var(--text-secondary);
      }

      .language-stat {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--spacing-xs);
      }

      .language-stat-value {
        font-weight: 600;
        color: var(--primary-color);
      }

      .language-stat-label {
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      @media (max-width: 1024px) {
        .progress-grid {
          grid-template-columns: 1fr;
          grid-template-rows: auto;
        }

        .stats-grid {
          grid-template-columns: repeat(2, 1fr);
        }

        .sessions-list {
          max-height: none;
          overflow-y: visible;
        }
      }

      @media (max-width: 768px) {
        .stats-grid {
          grid-template-columns: 1fr;
        }

        .session-item {
          flex-direction: column;
          align-items: stretch;
          gap: var(--spacing-sm);
        }
      }
    `
  ];

  connectedCallback() {
    super.connectedCallback();
    this.loadProgressData();
  }

  private async loadProgressData() {
    this.isLoading = true;
    this.error = '';

    try {
      // Load language information
      this.currentLanguage = await window.electronAPI.database.getCurrentLanguage();
      this.languageStats = await window.electronAPI.database.getLanguageStats();

      // Load study statistics for current language
      this.studyStats = await window.electronAPI.database.getStudyStats(this.currentLanguage);

      // Load all words for current language to calculate category statistics
      const allWords = await window.electronAPI.database.getAllWords(true, false, this.currentLanguage);
      this.wordCategoryStats = this.calculateWordCategoryStats(allWords);

      // Load recent study sessions
      this.recentSessions = await window.electronAPI.database.getRecentStudySessions(5);

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
      learningStrong: 0,
      learningWeak: 0,
      new: 0
    };

    words.forEach(word => {
      if (!word.lastStudied) {
        stats.new++;
      } else if (word.known) {
        stats.known++;
      } else if (word.strength >= ProgressSummary.WEAK_THRESHOLD) {
        stats.learningStrong++;
      } else {
        stats.learningWeak++;
      }
    });

    return stats;
  }

  private formatDate(date: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return 'Today';
    } else if (diffDays === 1) {
      return 'Yesterday';
    } else if (diffDays < 7) {
      return `${diffDays} days ago`;
    } else {
      return date.toLocaleDateString();
    }
  }

  private handleStartLearning() {
    router.goToTopicSelection();
  }

  private async handleLanguageChange(event: Event) {
    const select = event.target as HTMLSelectElement;
    const selectedLanguage = select.value;
    
    if (!selectedLanguage || selectedLanguage === this.currentLanguage) return;
    
    try {
      await window.electronAPI.database.setCurrentLanguage(selectedLanguage);
      this.currentLanguage = selectedLanguage;
      sessionManager.setActiveLanguage(selectedLanguage);
      this.dispatchEvent(new CustomEvent('language-changed', {
        detail: { language: selectedLanguage },
        bubbles: true,
        composed: true
      }));
      
      // Reload progress data for the new language
      await this.loadProgressData();
    } catch (error) {
      console.error('Failed to change language:', error);
      // Revert the selection
      select.value = this.currentLanguage;
    }
  }

  private capitalizeLanguage(language: string): string {
    return language.charAt(0).toUpperCase() + language.slice(1);
  }

  private getSupportedLanguages(): string[] {
    return ['italian', 'spanish', 'portuguese', 'polish', 'indonesian'];
  }

  private async handleContinueWeakWords() {
    try {
      const weakWords = await window.electronAPI.quiz.getWeakestWords(10);
      if (weakWords.length > 0) {
        router.goToLearning();
      } else {
        this.error = 'No words need practice right now. Start a new learning session!';
      }
    } catch (error) {
      console.error('Failed to get weak words:', error);
      this.error = 'Failed to load weak words. Please try again.';
    }
  }

  render() {
    if (this.isLoading) {
      return html`
        <div class="progress-container">
          <div class="loading-container">
            <div class="loading">
              <div class="spinner"></div>
              Loading progress data...
            </div>
          </div>
        </div>
      `;
    }

    if (this.error) {
      return html`
        <div class="progress-container">
          <div class="error-message">
            ${this.error}
          </div>
          <div class="action-buttons">
            <button class="btn btn-primary" @click=${this.handleStartLearning}>
              Start Learning
            </button>
          </div>
        </div>
      `;
    }

    if (!this.wordCategoryStats ||
      (this.wordCategoryStats.known + this.wordCategoryStats.learningStrong +
        this.wordCategoryStats.learningWeak + this.wordCategoryStats.new) === 0) {
      return html`
        <div class="progress-container">
          <div class="empty-state">
            <h3>No Learning Progress Yet</h3>
            <p>Start your first learning session to see your progress here.</p>
            <div class="action-buttons">
              <button class="btn btn-primary btn-large" @click=${this.handleStartLearning}>
                Start Learning
              </button>
            </div>
          </div>
        </div>
      `;
    }

    return html`
      <div class="progress-container">
        <div class="language-stats-display">
          <div class="language-stats">
            ${this.getSupportedLanguages().map(language => {
              const stat = this.languageStats.find(s => s.language === language);
              const studiedWords = stat ? stat.studiedWords : 0;
              const totalWords = stat ? stat.totalWords : 0;
              return html`
                <div class="language-stat ${language === this.currentLanguage ? 'current' : ''}">
                  <div class="language-stat-value">${studiedWords}/${totalWords}</div>
                  <div class="language-stat-label">${this.capitalizeLanguage(language)}</div>
                </div>
              `;
            })}
          </div>
        </div>
        <div class="progress-grid">
          <!-- Top Left: Word Categories -->
          <div class="progress-section">
            <h3 class="section-title">
              <span class="section-icon">📊</span>
              Study Statistics - ${this.capitalizeLanguage(this.currentLanguage)}
            </h3>
            <div class="stats-grid">
              <div class="stat-card known">
                <div class="stat-value">${this.wordCategoryStats?.known || 0}</div>
                <div class="stat-label">Known</div>
                <div class="stat-description">Strength > ${ProgressSummary.STRONG_THRESHOLD}</div>
              </div>

              <div class="stat-card learning-strong">
                <div class="stat-value">${this.wordCategoryStats?.learningStrong || 0}</div>
                <div class="stat-label">Learning - Strong</div>
                <div class="stat-description">Strength ${ProgressSummary.WEAK_THRESHOLD}-${ProgressSummary.STRONG_THRESHOLD}</div>
              </div>

              <div class="stat-card learning-weak">
                <div class="stat-value">${this.wordCategoryStats?.learningWeak || 0}</div>
                <div class="stat-label">Learning - Weak</div>
                <div class="stat-description">Strength < ${ProgressSummary.WEAK_THRESHOLD}</div>
              </div>

              <div class="stat-card new">
                <div class="stat-value">${this.wordCategoryStats?.new || 0}</div>
                <div class="stat-label">New</div>
                <div class="stat-description">Never quizzed</div>
              </div>
            </div>
          </div>

        </div>
      </div>
    `;
  }
}
