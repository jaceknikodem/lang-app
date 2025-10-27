/**
 * Session completion component for handling end of learning/quiz sessions
 */

import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { sharedStyles } from '../styles/shared.js';
import { router } from '../utils/router.js';
import { sessionManager } from '../utils/session-manager.js';
import { Word, StudyStats } from '../../shared/types/core.js';

export interface SessionSummary {
  type: 'learning' | 'quiz';
  wordsStudied: number;
  timeSpent?: number; // in minutes
  quizScore?: number;
  quizTotal?: number;
  completedWords: Word[];
  nextRecommendation: 'continue-learning' | 'take-quiz' | 'new-topic' | 'practice-weak';
}

@customElement('session-complete')
export class SessionComplete extends LitElement {
  @property({ type: Object })
  sessionSummary!: SessionSummary;

  @state()
  private studyStats: StudyStats | null = null;

  @state()
  private isLoading = false;

  static styles = [
    sharedStyles,
    css`
      :host {
        display: block;
        max-width: 600px;
        margin: 0 auto;
      }

      .completion-container {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-xl);
        text-align: center;
      }

      .completion-header {
        background: var(--success-light);
        border: 2px solid var(--success-color);
        border-radius: var(--border-radius);
        padding: var(--spacing-xl);
      }

      .completion-icon {
        font-size: 48px;
        margin-bottom: var(--spacing-md);
      }

      .completion-title {
        font-size: 28px;
        font-weight: 600;
        color: var(--success-dark);
        margin: 0 0 var(--spacing-sm) 0;
      }

      .completion-subtitle {
        font-size: 16px;
        color: var(--text-secondary);
        margin: 0;
      }

      .summary-stats {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
        gap: var(--spacing-md);
      }

      .stat-item {
        background: var(--background-secondary);
        border: 1px solid var(--border-color);
        border-radius: var(--border-radius);
        padding: var(--spacing-lg);
      }

      .stat-value {
        font-size: 24px;
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

      .quiz-score {
        background: var(--primary-light);
        border: 2px solid var(--primary-color);
        border-radius: var(--border-radius);
        padding: var(--spacing-lg);
        margin: var(--spacing-md) 0;
      }

      .score-percentage {
        font-size: 36px;
        font-weight: 700;
        color: var(--primary-color);
        margin: 0 0 var(--spacing-xs) 0;
      }

      .score-details {
        font-size: 16px;
        color: var(--text-secondary);
        margin: 0;
      }

      .words-practiced {
        text-align: left;
      }

      .words-title {
        font-size: 18px;
        font-weight: 600;
        color: var(--text-primary);
        margin: 0 0 var(--spacing-md) 0;
      }

      .words-list {
        display: flex;
        flex-wrap: wrap;
        gap: var(--spacing-sm);
      }

      .word-tag {
        background: var(--primary-light);
        color: var(--primary-dark);
        padding: var(--spacing-xs) var(--spacing-sm);
        border-radius: 12px;
        font-size: 14px;
        font-weight: 500;
      }

      .recommendation {
        background: var(--background-secondary);
        border: 1px solid var(--border-color);
        border-radius: var(--border-radius);
        padding: var(--spacing-lg);
      }

      .recommendation-title {
        font-size: 18px;
        font-weight: 600;
        color: var(--text-primary);
        margin: 0 0 var(--spacing-sm) 0;
      }

      .recommendation-text {
        font-size: 16px;
        color: var(--text-secondary);
        margin: 0 0 var(--spacing-md) 0;
      }

      .action-buttons {
        display: flex;
        gap: var(--spacing-md);
        justify-content: center;
        flex-wrap: wrap;
      }

      .action-button {
        padding: var(--spacing-md) var(--spacing-lg);
        border: 2px solid var(--primary-color);
        background: var(--background-primary);
        color: var(--primary-color);
        border-radius: var(--border-radius);
        font-size: 16px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s ease;
        min-width: 140px;
      }

      .action-button:hover {
        background: var(--primary-color);
        color: white;
      }

      .action-button.primary {
        background: var(--primary-color);
        color: white;
      }

      .action-button.primary:hover {
        background: var(--primary-dark);
        color: white;
      }

      @media (max-width: 768px) {
        .summary-stats {
          grid-template-columns: 1fr;
        }

        .action-buttons {
          flex-direction: column;
        }

        .action-button {
          width: 100%;
        }
      }
    `
  ];

  connectedCallback() {
    super.connectedCallback();
    this.loadUpdatedStats();
  }

  private async loadUpdatedStats() {
    try {
      this.studyStats = await window.electronAPI.database.getStudyStats();
    } catch (error) {
      console.error('Failed to load updated stats:', error);
    }
  }

  private getRecommendationText(): string {
    switch (this.sessionSummary.nextRecommendation) {
      case 'take-quiz':
        return 'Ready to test your knowledge? Take a quiz to reinforce what you\'ve learned.';
      case 'continue-learning':
        return 'Keep the momentum going! Continue learning with more sentences.';
      case 'practice-weak':
        return 'Focus on your weakest words to improve your overall mastery.';
      case 'new-topic':
        return 'Great progress! Try exploring a new topic to expand your vocabulary.';
      default:
        return 'Choose your next learning activity.';
    }
  }

  private async handleRecommendedAction() {
    this.isLoading = true;

    try {
      switch (this.sessionSummary.nextRecommendation) {
        case 'take-quiz':
          router.goToQuiz(this.sessionSummary.completedWords, 'foreign-to-english');
          break;
        case 'continue-learning':
          router.goToLearning(this.sessionSummary.completedWords);
          break;
        case 'practice-weak':
          const weakWords = await window.electronAPI.quiz.getWeakestWords(10);
          if (weakWords.length > 0) {
            router.goToLearning(weakWords);
          } else {
            router.goToTopicSelection();
          }
          break;
        case 'new-topic':
        default:
          router.goToTopicSelection();
          break;
      }
    } catch (error) {
      console.error('Failed to execute recommended action:', error);
      router.goToTopicSelection();
    } finally {
      this.isLoading = false;
    }
  }

  private handleViewProgress() {
    router.goToProgress();
  }

  private handleNewSession() {
    // Clear current session and start fresh
    sessionManager.clearSession();
    router.goToTopicSelection();
  }

  render() {
    const isQuiz = this.sessionSummary.type === 'quiz';
    const completionIcon = isQuiz ? '🎯' : '📚';
    const completionTitle = isQuiz ? 'Quiz Complete!' : 'Learning Session Complete!';

    return html`
      <div class="completion-container">
        <div class="completion-header">
          <div class="completion-icon">${completionIcon}</div>
          <h2 class="completion-title">${completionTitle}</h2>
          <p class="completion-subtitle">
            Great work! You've made progress in your language learning journey.
          </p>
        </div>

        ${isQuiz && this.sessionSummary.quizScore !== undefined && this.sessionSummary.quizTotal !== undefined ? html`
          <div class="quiz-score">
            <div class="score-percentage">
              ${Math.round((this.sessionSummary.quizScore / this.sessionSummary.quizTotal) * 100)}%
            </div>
            <div class="score-details">
              ${this.sessionSummary.quizScore} out of ${this.sessionSummary.quizTotal} correct
            </div>
          </div>
        ` : ''}

        <div class="summary-stats">
          <div class="stat-item">
            <div class="stat-value">${this.sessionSummary.wordsStudied}</div>
            <div class="stat-label">Words ${isQuiz ? 'Tested' : 'Studied'}</div>
          </div>

          ${this.sessionSummary.timeSpent ? html`
            <div class="stat-item">
              <div class="stat-value">${this.sessionSummary.timeSpent}</div>
              <div class="stat-label">Minutes</div>
            </div>
          ` : ''}

          ${this.studyStats ? html`
            <div class="stat-item">
              <div class="stat-value">${this.studyStats.totalWords}</div>
              <div class="stat-label">Total Words</div>
            </div>

            <div class="stat-item">
              <div class="stat-value">${Math.round(this.studyStats.averageStrength)}%</div>
              <div class="stat-label">Avg Strength</div>
            </div>
          ` : ''}
        </div>

        ${this.sessionSummary.completedWords.length > 0 ? html`
          <div class="words-practiced">
            <h3 class="words-title">Words ${isQuiz ? 'Tested' : 'Practiced'}</h3>
            <div class="words-list">
              ${this.sessionSummary.completedWords.slice(0, 10).map(word => html`
                <span class="word-tag">${word.word}</span>
              `)}
              ${this.sessionSummary.completedWords.length > 10 ? html`
                <span class="word-tag">+${this.sessionSummary.completedWords.length - 10} more</span>
              ` : ''}
            </div>
          </div>
        ` : ''}

        <div class="recommendation">
          <h3 class="recommendation-title">What's Next?</h3>
          <p class="recommendation-text">${this.getRecommendationText()}</p>
          
          <div class="action-buttons">
            <button 
              class="action-button primary"
              @click=${this.handleRecommendedAction}
              ?disabled=${this.isLoading}
            >
              ${this.sessionSummary.nextRecommendation === 'take-quiz' ? 'Take Quiz' :
                this.sessionSummary.nextRecommendation === 'continue-learning' ? 'Continue Learning' :
                this.sessionSummary.nextRecommendation === 'practice-weak' ? 'Practice Weak Words' :
                'New Topic'}
            </button>
            
            <button 
              class="action-button"
              @click=${this.handleViewProgress}
            >
              View Progress
            </button>
            
            <button 
              class="action-button"
              @click=${this.handleNewSession}
            >
              New Session
            </button>
          </div>
        </div>
      </div>
    `;
  }
}