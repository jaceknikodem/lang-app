/**
 * Progress summary component for displaying study statistics and word knowledge status
 */

import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { sharedStyles } from '../styles/shared.js';
import { router } from '../utils/router.js';
import { Word, StudyStats } from '../../shared/types/core.js';

interface WordProgress {
  word: Word;
  progressPercent: number;
  statusLabel: string;
  statusClass: string;
}

@customElement('progress-summary')
export class ProgressSummary extends LitElement {
  @state()
  private studyStats: StudyStats | null = null;

  @state()
  private recentWords: WordProgress[] = [];

  @state()
  private recentSessions: Array<{id: number, wordsStudied: number, whenStudied: Date}> = [];

  @state()
  private isLoading = true;

  @state()
  private error = '';

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
        gap: var(--spacing-xl);
      }

      .progress-header {
        text-align: center;
      }

      .progress-title {
        font-size: 28px;
        font-weight: 600;
        color: var(--text-primary);
        margin: 0 0 var(--spacing-sm) 0;
      }

      .progress-subtitle {
        font-size: 16px;
        color: var(--text-secondary);
        margin: 0;
      }

      .stats-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
        gap: var(--spacing-lg);
      }

      .stat-card {
        background: var(--background-secondary);
        border: 1px solid var(--border-color);
        border-radius: var(--border-radius);
        padding: var(--spacing-lg);
        text-align: center;
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

      .words-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
        gap: var(--spacing-md);
      }

      .word-progress-card {
        background: var(--background-primary);
        border: 1px solid var(--border-color);
        border-radius: var(--border-radius);
        padding: var(--spacing-md);
        transition: all 0.2s ease;
      }

      .word-progress-card:hover {
        box-shadow: var(--shadow-light);
        border-color: var(--primary-color);
      }

      .word-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        margin-bottom: var(--spacing-sm);
      }

      .word-info {
        flex: 1;
      }

      .word-foreign {
        font-size: 18px;
        font-weight: 600;
        color: var(--text-primary);
        margin: 0 0 var(--spacing-xs) 0;
      }

      .word-translation {
        font-size: 14px;
        color: var(--text-secondary);
        margin: 0;
      }

      .word-status {
        padding: 4px 8px;
        border-radius: 12px;
        font-size: 12px;
        font-weight: 500;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .status-learning {
        background: var(--warning-light);
        color: var(--warning-dark);
      }

      .status-known {
        background: var(--success-light);
        color: var(--success-dark);
      }

      .status-weak {
        background: var(--error-light);
        color: var(--error-dark);
      }

      .status-strong {
        background: var(--primary-light);
        color: var(--primary-dark);
      }

      .progress-bar-container {
        margin-top: var(--spacing-sm);
      }

      .progress-bar-label {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: var(--spacing-xs);
        font-size: 12px;
        color: var(--text-secondary);
      }

      .progress-bar {
        width: 100%;
        height: 8px;
        background: var(--border-color);
        border-radius: 4px;
        overflow: hidden;
      }

      .progress-fill {
        height: 100%;
        transition: width 0.3s ease;
      }

      .progress-fill.learning {
        background: var(--warning-color);
      }

      .progress-fill.known {
        background: var(--success-color);
      }

      .progress-fill.weak {
        background: var(--error-color);
      }

      .progress-fill.strong {
        background: var(--primary-color);
      }

      .sessions-list {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-sm);
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
        justify-content: center;
        gap: var(--spacing-md);
        margin-top: var(--spacing-lg);
        flex-wrap: wrap;
      }

      .error-message {
        color: var(--error-color);
        background: #ffebee;
        padding: var(--spacing-md);
        border-radius: var(--border-radius);
        border: 1px solid #ffcdd2;
        text-align: center;
      }

      @media (max-width: 768px) {
        .stats-grid {
          grid-template-columns: 1fr;
        }

        .words-grid {
          grid-template-columns: 1fr;
        }

        .session-item {
          flex-direction: column;
          align-items: stretch;
          gap: var(--spacing-sm);
        }

        .action-buttons {
          flex-direction: column;
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
      // Load study statistics
      this.studyStats = await window.electronAPI.database.getStudyStats();

      // Load recent words with progress
      const allWords = await window.electronAPI.database.getAllWords(true, false);
      this.recentWords = allWords
        .filter(word => word.lastStudied) // Only words that have been studied
        .sort((a, b) => {
          const dateA = a.lastStudied ? new Date(a.lastStudied).getTime() : 0;
          const dateB = b.lastStudied ? new Date(b.lastStudied).getTime() : 0;
          return dateB - dateA; // Most recent first
        })
        .slice(0, 12) // Show top 12 recent words
        .map(word => this.createWordProgress(word));

      // Load recent study sessions
      this.recentSessions = await window.electronAPI.database.getRecentStudySessions(5);

    } catch (error) {
      console.error('Failed to load progress data:', error);
      this.error = 'Failed to load progress data. Please try again.';
    } finally {
      this.isLoading = false;
    }
  }

  private createWordProgress(word: Word): WordProgress {
    const strength = word.strength;
    let statusLabel: string;
    let statusClass: string;

    if (word.known) {
      statusLabel = 'Known';
      statusClass = 'known';
    } else if (strength >= 70) {
      statusLabel = 'Strong';
      statusClass = 'strong';
    } else if (strength >= 30) {
      statusLabel = 'Learning';
      statusClass = 'learning';
    } else {
      statusLabel = 'Weak';
      statusClass = 'weak';
    }

    return {
      word,
      progressPercent: strength,
      statusLabel,
      statusClass
    };
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

  private async handleContinueWeakWords() {
    try {
      const weakWords = await window.electronAPI.quiz.getWeakestWords(10);
      if (weakWords.length > 0) {
        router.goToLearning(weakWords);
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

    if (!this.studyStats || this.studyStats.totalWords === 0) {
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
        <div class="progress-header">
          <h2 class="progress-title">Learning Progress</h2>
          <p class="progress-subtitle">
            Track your vocabulary mastery and study statistics
          </p>
        </div>

        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-value">${this.studyStats.totalWords}</div>
            <div class="stat-label">Total Words</div>
            <div class="stat-description">Words you've studied</div>
          </div>

          <div class="stat-card">
            <div class="stat-value">${this.studyStats.wordsStudied}</div>
            <div class="stat-label">Words Practiced</div>
            <div class="stat-description">In recent sessions</div>
          </div>

          <div class="stat-card">
            <div class="stat-value">${Math.round(this.studyStats.averageStrength)}%</div>
            <div class="stat-label">Average Strength</div>
            <div class="stat-description">Overall mastery level</div>
          </div>

          <div class="stat-card">
            <div class="stat-value">
              ${this.studyStats.lastStudyDate ? this.formatDate(new Date(this.studyStats.lastStudyDate)) : 'Never'}
            </div>
            <div class="stat-label">Last Study</div>
            <div class="stat-description">Most recent session</div>
          </div>
        </div>

        ${this.recentWords.length > 0 ? html`
          <div>
            <h3 class="section-title">
              <span class="section-icon">📚</span>
              Recent Words
            </h3>
            <div class="words-grid">
              ${this.recentWords.map(wordProgress => html`
                <div class="word-progress-card">
                  <div class="word-header">
                    <div class="word-info">
                      <h4 class="word-foreign">${wordProgress.word.word}</h4>
                      <p class="word-translation">${wordProgress.word.translation}</p>
                    </div>
                    <span class="word-status status-${wordProgress.statusClass}">
                      ${wordProgress.statusLabel}
                    </span>
                  </div>
                  <div class="progress-bar-container">
                    <div class="progress-bar-label">
                      <span>Strength</span>
                      <span>${wordProgress.progressPercent}%</span>
                    </div>
                    <div class="progress-bar">
                      <div 
                        class="progress-fill ${wordProgress.statusClass}"
                        style="width: ${wordProgress.progressPercent}%"
                      ></div>
                    </div>
                  </div>
                </div>
              `)}
            </div>
          </div>
        ` : ''}

        ${this.recentSessions.length > 0 ? html`
          <div>
            <h3 class="section-title">
              <span class="section-icon">📊</span>
              Recent Sessions
            </h3>
            <div class="sessions-list">
              ${this.recentSessions.map(session => html`
                <div class="session-item">
                  <div class="session-info">
                    <div class="session-words">${session.wordsStudied} words practiced</div>
                    <div class="session-date">${this.formatDate(new Date(session.whenStudied))}</div>
                  </div>
                  <div class="session-badge">Session</div>
                </div>
              `)}
            </div>
          </div>
        ` : ''}

        <div class="action-buttons">
          <button class="btn btn-primary btn-large" @click=${this.handleStartLearning}>
            New Learning Session
          </button>
          <button class="btn btn-secondary" @click=${this.handleContinueWeakWords}>
            Practice Weak Words
          </button>
        </div>
      </div>
    `;
  }
}